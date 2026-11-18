"""A question retrieves one of three fixed, synthetic local passages.

No application data, APIs, server, persisted index or generated answer is used.
"""

import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time

MODEL = "BAAI/bge-small-zh-v1.5"
QUESTION = "星灯工具能把结果导出成电子表格吗？"
QUERY_INSTRUCTION = "为这个句子生成表示以用于检索相关文章："
EXPECTED_SOURCE = "export-guide"
SOURCES = [
    ("export-guide", "samples/export-guide.md"),
    ("appearance", "samples/appearance.md"),
    ("weather", "samples/weather.md"),
]


def main():
    parser = argparse.ArgumentParser(description="用问题检索三段虚构资料，不读取个人文档")
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--top-k", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--question", default=QUESTION)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).with_name("result.json"))
    args = parser.parse_args()
    question = args.question.strip()
    if not question:
        parser.error("问题不能为空")
    expected_source = EXPECTED_SOURCE if question == QUESTION else None
    try:
        model_dir = args.model_dir.resolve(strict=True)
    except OSError:
        parser.error("指定的本地模型目录不存在；本脚本不会下载模型")
    model_files = sorted(model_dir.glob("*.onnx"))
    if len(model_files) != 1:
        parser.error("模型目录应包含一份ONNX文件；本脚本不会下载模型")

    chunks = []
    for doc_id, source in SOURCES:
        raw = Path(__file__).with_name("samples").joinpath(Path(source).name).read_bytes()
        text = raw.decode("utf-8")
        if not text.strip() or len(text) > 300:
            raise ValueError("每份固定示例须为300字符内的非空段落")
        chunks.append({"document_id": doc_id, "chunk_id": f"{doc_id}:1",
                       "source": source, "source_sha256": hashlib.sha256(raw).hexdigest(),
                       "start": 0, "end": len(text), "text": text})

    for name in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_HUB_DISABLE_TELEMETRY"):
        os.environ[name] = "1"
    os.environ["DO_NOT_TRACK"] = "1"
    network_attempts = []

    def offline_only(event, _args):
        if event in {"socket.connect", "socket.getaddrinfo"}:
            network_attempts.append(event)
            raise RuntimeError("此实验只允许本机推理，不允许联网")

    sys.addaudithook(offline_only)
    import numpy as np
    from fastembed import TextEmbedding

    started = time.perf_counter()
    model = TextEmbedding(model_name=MODEL, specific_model_path=str(model_dir),
                          local_files_only=True, threads=2,
                          providers=["CPUExecutionProvider"])
    inputs = [QUERY_INSTRUCTION + question, *(chunk["text"] for chunk in chunks)]
    vectors = np.asarray(list(model.embed(inputs, batch_size=4)), dtype=np.float64)
    if vectors.shape != (4, 512) or not np.isfinite(vectors).all():
        raise ValueError("问题与资料的向量维度或数值异常")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if (norms == 0).any():
        raise ValueError("零向量不能计算余弦相似度")
    normalized = vectors / norms
    scores = normalized[1:] @ normalized[0]
    if not np.isfinite(scores).all() or (np.abs(scores) > 1.000001).any():
        raise ValueError("相似度数值异常")
    ranking = sorted(
        ({**chunk, "score": float(score)} for chunk, score in zip(chunks, scores)),
        key=lambda item: (-item["score"], item["document_id"]),
    )
    if network_attempts:
        raise ValueError("实验过程中发生联网尝试，结果不符合本实验边界")
    with model_files[0].open("rb") as stream:
        weight_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    result = {
        "model": MODEL, "onnx_repository": "Qdrant/bge-small-zh-v1.5",
        "model_snapshot": model_dir.name, "onnx_sha256": weight_hash,
        "question": question, "query_instruction": QUERY_INSTRUCTION,
        "query_embedding_input": inputs[0], "documents_have_instruction": False,
        "metric": "cosine_similarity", "dimensions": 512,
        "source_base": "learning/embedding-02",
        "top_k": args.top_k, "ranking": ranking, "selected": ranking[:args.top_k],
        "expected_top1_document": expected_source,
        "example_expectation_met": (
            ranking[0]["document_id"] == expected_source if expected_source else None
        ),
        "query_vector_first_8": vectors[0, :8].tolist(),
        "runtime_versions": {name: importlib.metadata.version(name)
                             for name in ("fastembed", "numpy", "onnxruntime")},
        "python_version": sys.version.split()[0], "provider": "CPUExecutionProvider",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "network_attempts": len(network_attempts), "generated_answer": None,
        "scope": "one question, three fixed synthetic passages, in-memory retrieval only",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"Model: {MODEL}; dimensions: 512; top-k: {args.top_k}")
    for number, item in enumerate(ranking, start=1):
        print(f'{number}. {item["source"]}: {item["score"]:.6f}')
    print(f'Expected source ranked first: {result["example_expectation_met"]}')
    print(f'Network attempts: {len(network_attempts)}')


if __name__ == "__main__":
    main()

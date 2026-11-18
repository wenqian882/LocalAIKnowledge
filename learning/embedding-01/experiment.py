"""Compare three synthetic sentences with an existing, offline BGE model.

This learning script is independent of the Electron app. It never loads documents,
keys, conversation history, or a vector database. Model files must already exist.
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
SENTENCES = ["支持导出 Excel。", "可以生成电子表格。", "明天可能下雨。"]


def main():
    parser = argparse.ArgumentParser(description="离线短句向量实验，不读取个人文档")
    parser.add_argument("--model-dir", required=True, type=Path,
                        help="已下载的Qdrant BGE ONNX模型目录")
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).with_name("result.json"))
    args = parser.parse_args()
    try:
        model_dir = args.model_dir.resolve(strict=True)
    except OSError:
        parser.error("指定的本地模型目录不存在；本脚本不会下载模型")
    model_files = sorted(model_dir.glob("*.onnx"))
    if len(model_files) != 1:
        parser.error("模型目录应包含一份ONNX文件；本脚本不会下载模型")

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
    model = TextEmbedding(
        model_name=MODEL,
        specific_model_path=str(model_dir),
        local_files_only=True,
        threads=2,
        providers=["CPUExecutionProvider"],
    )
    vectors = np.asarray(list(model.embed(SENTENCES, batch_size=3)), dtype=np.float64)
    if vectors.shape != (3, 512) or not np.isfinite(vectors).all():
        raise ValueError("模型向量维度或数值异常")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if (norms == 0).any():
        raise ValueError("零向量不能计算余弦相似度")
    normalized = vectors / norms
    similarities = normalized @ normalized.T
    if not np.allclose(np.diag(similarities), 1.0, atol=1e-6):
        raise ValueError("向量与自身的相似度校验失败")
    if not np.allclose(similarities, similarities.T, atol=1e-6):
        raise ValueError("相似度矩阵应对称")
    if (np.abs(similarities) > 1.000001).any() or network_attempts:
        raise ValueError("相似度范围异常，或发生了联网尝试")

    with model_files[0].open("rb") as stream:
        weight_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    result = {
        "model": MODEL,
        "onnx_repository": "Qdrant/bge-small-zh-v1.5",
        "model_snapshot": model_dir.name,
        "onnx_sha256": weight_hash,
        "metric": "cosine_similarity",
        "encoding": "same model, raw sentences, no query instruction",
        "dimensions": int(vectors.shape[1]),
        "sentences": dict(zip("ABC", SENTENCES)),
        "vector_preview_first_8": {
            label: row[:8].tolist() for label, row in zip("ABC", vectors)
        },
        "pairs": [
            {"pair": "A/B", "score": float(similarities[0, 1])},
            {"pair": "A/C", "score": float(similarities[0, 2])},
            {"pair": "B/C", "score": float(similarities[1, 2])},
        ],
        "hypothesis": "A/B is greater than A/C and B/C",
        "hypothesis_observed": bool(
            similarities[0, 1] > max(similarities[0, 2], similarities[1, 2])
        ),
        "runtime_versions": {
            name: importlib.metadata.version(name)
            for name in ("fastembed", "numpy", "onnxruntime")
        },
        "python_version": sys.version.split()[0],
        "provider": "CPUExecutionProvider",
        "elapsed_seconds": round(time.perf_counter() - started, 3),
        "network_attempts": len(network_attempts),
        "checks": {"finite_512d_vectors": True, "self_similarity": True,
                   "symmetry": True, "range": True},
        "scope": "three fixed synthetic sentences; no user documents or API calls",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                           encoding="utf-8")
    print(f"Model: {MODEL}; dimensions: {vectors.shape[1]}")
    for pair in result["pairs"]:
        print(f'{pair["pair"]}: {pair["score"]:.6f}')
    print(f'Hypothesis observed: {result["hypothesis_observed"]}')
    print(f'Network attempts: {len(network_attempts)}')


if __name__ == "__main__":
    main()

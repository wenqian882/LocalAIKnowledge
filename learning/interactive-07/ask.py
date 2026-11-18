"""An interactive learning runner that connects retrieval and prompt assembly."""  # 文件说明：这个脚本把接收问题、本机检索和消息组装连接成一个交互练习。

import argparse  # 导入标准库argparse，用来读取启动命令里的--question、--top-k等参数。
import json  # 导入json，用来把JSON文件里的文字转换成Python字典、列表等数据。
import os  # 导入os，用来读取Windows提供的环境变量，例如用户数据目录的位置。
from pathlib import Path  # 从pathlib中导入Path；用它表示文件路径，比手动拼接斜杠更方便。
import subprocess  # 导入subprocess，让当前Python程序能够启动并等待另一个Python脚本。
import sys  # 导入sys，用来获取当前Python解释器路径、输出错误信息和设置退出状态。
import uuid  # 导入uuid，用来产生随机编号，避免不同问题的输出目录互相覆盖。

HERE = Path(__file__).resolve().parent  # __file__是当前脚本路径；resolve()转为绝对路径，parent取脚本所在文件夹。
PROJECT = HERE.parents[1]  # parents的索引从0开始：HERE.parents[0]是learning，[1]就是项目根目录。


def load_runtime():  # def定义一个函数；这里只登记处理步骤，直到调用load_runtime()时才执行。
    config_file = HERE / "runtime.local"  # 确定本机配置文件的位置；Path之间的/表示拼接路径，不是做除法。
    if not config_file.exists():  # exists()检查文件是否存在；not表示取反，因此文件不存在时进入下面的分支。
        raise ValueError("缺少runtime.local，请参照本目录README配置本机环境")  # raise主动抛出ValueError异常，停止当前函数，让外层代码报告配置缺失。
    config = json.loads(config_file.read_text(encoding="utf-8"))  # 先按UTF-8读取文件文字，再用json.loads转换成字典，保存到config变量。
    if not Path(config["python"]).is_file() or not Path(config["model_dir"]).is_dir():  # 用字典键读取两个配置路径；只要Python文件或模型目录有一个无效，就进入报错分支。
        raise ValueError("本机Python或模型目录不存在，请检查runtime.local")  # 抛出路径配置错误；不会在此自动安装Python或下载模型。
    return config  # return把配置字典交给调用处；main中会用runtime变量接住它。


def run_query(question, top_k, runtime):  # 定义一次完整处理流程；三个形参分别接收问题文字、选取数量和本机配置字典。
    # 学习者的问题和输出放到用户数据目录，不写进源码仓库。
    data_root = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")  # 优先读取Windows的LOCALAPPDATA；没有该值时才使用用户目录下的备用路径。
    folder = data_root / "LocalAIKnowledgeLearning" / "interactive-07" / uuid.uuid4().hex  # 拼出本轮独立输出目录；uuid.uuid4().hex产生随机编号，保证每轮使用不同位置。
    folder.mkdir(parents=True)  # 实际创建这个目录；parents=True表示缺少的上级目录也一起创建。
    report_file = folder / "retrieval.json"  # 给检索结果确定文件名；这一步只是建立路径对象，还没有写入文件。
    env = {**os.environ, "PYTHONUTF8": "1"}  # **展开并复制现有环境变量，再指定子进程使用UTF-8，减少中文编码问题。
    print("\n正在本机检索示例资料…", flush=True)  # \n先换行；flush=True要求立即显示进度，而不是先留在输出缓冲区。

    # 参数列表按项传值，避免把用户输入拼进shell命令。
    subprocess.run([  # 启动检索子进程；方括号里是参数列表，run会等待它完成后才继续往下。
        runtime["python"], "-X", "utf8",  # runtime["python"]读取配置里的解释器；-X utf8要求该Python按UTF-8运行。
        str(PROJECT / "learning" / "embedding-02" / "retrieve.py"),  # 拼出检索脚本的绝对路径，str()把Path对象转换成命令行需要的文字。
        "--model-dir", runtime["model_dir"], "--question=" + question,  # 将模型目录和本轮问题传给检索脚本；问题作为参数值，不作为shell命令执行。
        "--top-k", str(top_k), "--output", str(report_file),  # 将整数top_k转成文字参数，并指定本轮检索结果要保存到哪个文件。
    ], check=True, env=env, timeout=120)  # 结束参数列表；非零退出码会抛异常，env传环境设置，最多等待120秒。

    # 把本轮检索输出文件交给下一段程序，连接两段已有功能。
    subprocess.run([  # 启动第二个子进程，复用已有消息构建器，把刚才的检索结果继续向后传。
        sys.executable, "-X", "utf8",  # sys.executable是当前启动器使用的Python路径；这个步骤只需标准库。
        str(PROJECT / "learning" / "generation-03" / "build_prompt.py"),  # 定位消息构建脚本；它负责把问题、参考原文和回答规则拼成模型输入。
        "--input", str(report_file), "--output-dir", str(folder),  # --input读取本轮结果，--output-dir把生成的消息放进同一个输出目录。
    ], check=True, env=env, timeout=20)  # 等待消息构建完成；失败就抛异常，最多等待20秒，期间使用同一套环境设置。

    report = json.loads(report_file.read_text(encoding="utf-8"))  # 读取本轮retrieval.json并解析成字典，后面就能通过键名取出其中的数据。
    print("\n选中的参考资料：")  # 打印一个说明标题；它不是模型生成的答案。
    for number, chunk in enumerate(report["selected"], start=1):  # for逐块遍历selected列表；enumerate额外提供从1开始的编号，chunk是当前块的字典。
        print(f"[资料{number}] {chunk['source']}  相似度 {chunk['score']:.3f}")  # f字符串将大括号里的值插入文字；.3f只把显示分数保留三位小数，不改原值。
        print(chunk["text"])  # 从当前块字典中读取text字段，并打印这段参考原文。
    print("可粘贴到聊天应用的消息：" + str(folder / "paste-into-chat.txt"))  # 将提示文字与文件路径拼接后显示；只告诉你文件在哪，不自动打开或发送它。
    print("结果只保存在本机；本轮没有调用回答API。\n", flush=True)  # 显示本轮边界并立即刷新输出；这里还没有调用DeepSeek或GPT生成回答。
    return folder  # 将本轮目录返回给调用者；当前main没有接收此返回值，目录位置已经在上面打印。


def main():  # 定义主流程函数，统一组织参数读取、模式选择和连续提问。
    parser = argparse.ArgumentParser(description="提问→本机向量检索→准备带引用消息")  # 创建命令行参数解析器；description是在帮助信息中展示的程序说明。
    parser.add_argument("--question", help="可选，执行一轮后退出；不填则连续提问")  # 登记可选的--question参数；不提供时args.question默认是None。
    parser.add_argument("--top-k", type=int, choices=(1, 2, 3), default=1)  # 登记--top-k：转成整数，只允许1、2、3；默认1，解析后的属性名是args.top_k。
    args = parser.parse_args()  # 读取启动命令的参数，得到args对象；用args.question、args.top_k访问对应值。
    runtime = load_runtime()  # 真正执行前面的load_runtime函数，并把返回的配置字典存入runtime。
    print("交互检索练习：只检索三份虚构示例，不读取个人文档，不调用付费API。")  # 告诉使用者本练习的数据范围和当前能力，避免把它当作个人知识库问答。
    if args.question is not None:  # is not None判断启动时是否提供了问题；如果提供了，就走单次执行模式。
        if not args.question.strip():  # 先去掉首尾空白；如果剩下的是空字符串，not判断成立，进入错误处理。
            parser.error("问题不能为空")  # 显示参数错误并退出程序，不把空问题交给检索器。
        run_query(args.question.strip(), args.top_k, runtime)  # 把清理后的问题、选取数量和配置交给run_query，完成一轮检索与消息组装。
        return  # 结束main函数；单次模式处理完就退出，不再进入下面的连续提问循环。
    while True:  # 开启持续循环；每轮会等待用户输入，遇到break或未处理异常才结束。
        question = input("输入问题（直接回车退出）：").strip()  # input显示提示并等待回车，返回字符串；strip()去掉首尾空白，再存进question。
        if not question:  # 空字符串在if中视为假；not question表示用户直接回车，或只输入了空白。
            break  # 跳出最近这一层while循环；这才是直接回车能够结束练习的原因。
        try:  # try包住本轮操作；若抛出下面列出的异常，就交给except处理。
            run_query(question, args.top_k, runtime)  # 调用自己定义的函数；三个实参依次对应question、top_k、runtime三个形参。
        except (subprocess.SubprocessError, OSError, ValueError) as error:  # 捕获子进程、文件和数值相关的这几类异常；as error给当前异常对象起一个名字。
            print(f"这一轮未完成：{error}\n请检查环境或换一个简短问题重试。")  # 把错误原因插入提示并显示；本轮结束后while会继续等待下一次输入。


if __name__ == "__main__":  # ==用于比较；直接运行此文件时条件为真，被其他脚本import时不会自动执行main。
    try:  # 外层try负责处理整个程序启动或运行中没有被内层处理的异常。
        main()  # 调用main()开始执行主流程；只有定义函数，不写这次调用，并不会启动交互。
    except (EOFError, KeyboardInterrupt):  # 捕获输入通道关闭，或用户按Ctrl+C产生的中断，作为正常退出处理。
        print("\n练习已退出。")  # 给出退出提示；这里没有设置失败退出码。
    except (OSError, ValueError, KeyError) as error:  # 捕获路径/配置值/缺少字典键等错误，并用下面两行报告失败。
        print(f"启动失败：{error}", file=sys.stderr)  # 把错误写到stderr错误输出通道；file=在此指定通道，不是创建一个文件。
        sys.exit(1)  # 结束程序并返回失败状态1；外层CMD会保留这个状态，0通常表示成功。

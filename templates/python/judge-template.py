"""
Botzone Python Judge（裁判）模板

裁判程序负责控制对局流程：
1. 首轮（round=0）：接收 initdata，生成初始数据，向各 Bot 发送初始请求
2. 中间轮：接收各 Bot 的回复，判定并发送下一轮请求
3. 最终轮：判定对局结束，输出各 Bot 得分

交互协议：
- stdin: JSON 对象
  - requests:  list[str]  历史数据（首轮 requests[0] = initdata）
  - responses: list[str]  历史数据（裁判自己之前的输出列表）
- stdout: 单行 JSON 对象
  - command:   "request" | "finish"
  - content:   dict
    - request 时: {"0": "发给Bot0的请求", "1": "发给Bot1的请求", ...}
    - finish 时:  {"0": 得分, "1": 得分, ...}（0~2，支持平局）
  - display:   dict   前端展示用的额外数据（对局回放时可见）
  - initdata:  str    仅首轮可选，由裁判生成的初始数据（如随机种子）
"""

import json
import random


def main():
    # 读取输入
    input_data = json.loads(input())

    requests = input_data["requests"]
    responses = input_data["responses"]

    # 当前轮次 = 已有的 responses 数量
    # round_num=0 表示首轮（尚无 Bot 回复），round_num>=1 表示已收到 Bot 回复
    round_num = len(responses)

    if round_num == 0:
        # ====== 首轮：解析 initdata，生成初始数据 ======
        initdata = requests[0]  # 由提交任务时传入的 initdata

        # 如果 initdata 为空，裁判自行生成（例如随机种子）
        if not initdata:
            initdata = str(random.randint(0, 2**31 - 1))

        # 用 initdata 初始化游戏状态（示例：生成棋盘、地图等）
        # 这里假设直接把 initdata 作为初始请求发给两个 Bot

        output = {
            "command": "request",
            "content": {"0": initdata, "1": initdata},  # 向两个 Bot 发送初始请求
            "initdata": initdata,                         # 保存 initdata（首轮专用）
            "display": {"round": 1, "info": "对局开始"},
        }
    else:
        # ====== 中间轮 / 最终轮 ======
        # requests[-1] 是上一轮各 Bot 的回复汇总（JSON 对象: {"0": "...", "1": "..."}）
        last_responses = json.loads(requests[-1])

        resp0 = last_responses.get("0", "")  # Bot 0 的回复
        resp1 = last_responses.get("1", "")  # Bot 1 的回复

        # ====== 在此编写裁判逻辑 ======
        # 示例：5 轮后结束对局，Bot 0 获胜
        if round_num >= 5:
            # 结束对局：content 为各 Bot 的得分
            # 得分范围 0~2：胜=2, 平=1, 负=0（也可用 1/0 表示胜/负）
            output = {
                "command": "finish",
                "content": {"0": 2, "1": 0},
                "display": {"round": round_num, "info": "对局结束", "winner": 0},
            }
        else:
            # 继续对局：交换对手回复作为下一轮请求
            output = {
                "command": "request",
                "content": {"0": resp1, "1": resp0},
                "display": {"round": round_num + 1},
            }
        # ====== 裁判逻辑结束 ======

    print(json.dumps(output))


if __name__ == "__main__":
    main()

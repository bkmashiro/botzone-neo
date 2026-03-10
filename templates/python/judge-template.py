"""
Botzone Python Judge（裁判）模板

裁判程序负责：
1. 首轮：接收 initdata，向各 Bot 发送初始请求
2. 中间轮：接收各 Bot 的回复，判定并发送下一轮请求
3. 最终轮：判定对局结束，输出各 Bot 得分

输出格式（单行 JSON）：
{
    "command": "request" | "finish",
    "content": {"0": "...", "1": "..."},
    "display": { ... }
}
"""

import json


def main():
    input_data = json.loads(input())

    requests = input_data["requests"]
    responses = input_data["responses"]

    round_num = len(responses)

    if round_num == 0:
        # ====== 首轮：解析 initdata，发送初始请求 ======
        initdata = requests[0]
        output = {
            "command": "request",
            "content": {"0": initdata, "1": initdata},
            "display": {"round": 1, "info": "对局开始"},
        }
    else:
        # 解析上轮各 Bot 的回复
        last_responses = json.loads(requests[-1])

        # ====== 在此编写裁判逻辑 ======
        if round_num >= 3:
            # 示例：3 轮后结束
            output = {
                "command": "finish",
                "content": {"0": 1, "1": 0},
                "display": {"round": round_num, "info": "对局结束"},
            }
        else:
            # 交换对手回复作为下一轮请求
            resp0 = last_responses.get("0", "")
            resp1 = last_responses.get("1", "")
            output = {
                "command": "request",
                "content": {"0": resp1, "1": resp0},
                "display": {"round": round_num + 1},
            }
        # ====== 裁判逻辑结束 ======

    print(json.dumps(output))


if __name__ == "__main__":
    main()

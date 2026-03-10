"""
Botzone Python Bot 模板

交互协议（完整 JSON 模式）：
- stdin: 完整 JSON 对象
  - requests:   list[str]  历史请求列表（裁判发给你的指令）
  - responses:  list[str]  历史响应列表（你之前的回复）
  - data:       str        本局持久化数据（上轮你保存的，首轮为空）
  - globaldata: str        全局持久化数据（跨对局共享）
- stdout: 单行 JSON 对象
  - response:   str        本轮回复（必填）
  - debug:      str        调试信息（可选，不影响对局，仅开发者可见）
  - data:       str        本局持久化数据（可选，下轮会原样传回）
  - globaldata: str        全局持久化数据（可选，跨对局保留）

========================================================================
简化交互模式（替代写法）：
  如果你不需要 data/globaldata/debug，可以让 stdout 首行输出纯文本，
  系统会自动将该行作为 response。例如：
    print("3 5")  # 等价于 {"response": "3 5"}
  注意：简化模式下无法使用持久化数据和调试信息。
========================================================================
"""

import json
import sys
import random


def make_decision(current_request: str,
                  requests: list,
                  responses: list,
                  data: str) -> str:
    """
    决策函数 — 在此实现你的策略逻辑

    参数：
        current_request: 本轮裁判发来的请求（字符串，具体格式取决于游戏）
        requests:        完整历史请求列表
        responses:       完整历史响应列表
        data:            本局持久化数据（上轮保存的，首轮为空字符串）

    返回：
        你的回复字符串
    """
    # ====== 示例：随机选择一个方向 ======
    # 假设游戏需要输出 0~3 的方向
    direction = random.randint(0, 3)
    return str(direction)


def main():
    # 读取完整输入（单行 JSON）
    input_data = json.loads(input())

    # 解析各字段
    requests = input_data["requests"]             # 历史请求列表
    responses = input_data["responses"]           # 历史响应列表
    data = input_data.get("data", "")             # 本局持久化数据
    globaldata = input_data.get("globaldata", "") # 全局持久化数据

    # 获取本轮裁判请求（requests 列表的最后一个元素）
    current_request = requests[-1]

    # 调用决策函数
    my_response = make_decision(current_request, requests, responses, data)

    # 持久化数据示例：记录总轮次
    turn_count = int(data) + 1 if data else 1

    # 构造输出 JSON
    output = {
        "response": my_response,                   # 必填：本轮回复
        "debug": f"turn {turn_count}",             # 可选：调试信息
        "data": str(turn_count),                   # 可选：本局持久化（下轮通过 data 字段传回）
        # "globaldata": "全局状态",                # 可选：跨对局持久化
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()

/**
 * Botzone TypeScript Bot 模板
 *
 * 交互协议（完整 JSON 模式）：
 * - stdin: 完整 JSON 对象
 *   - requests:   string[]  历史请求列表（裁判发给你的指令）
 *   - responses:  string[]  历史响应列表（你之前的回复）
 *   - data:       string    本局持久化数据（上轮你保存的，首轮为空）
 *   - globaldata: string    全局持久化数据（跨对局共享）
 * - stdout: 单行 JSON 对象
 *   - response:   string    本轮回复（必填）
 *   - debug?:     string    调试信息（可选，不影响对局，仅开发者可见）
 *   - data?:      string    本局持久化数据（可选，下轮会原样传回）
 *   - globaldata?: string   全局持久化数据（可选，跨对局保留）
 *
 * 运行：tsc bot-template.ts && node bot-template.js
 *
 * ========================================================================
 * 简化交互模式（替代写法）：
 *   如果你不需要 data/globaldata/debug，可以让 stdout 首行输出纯文本，
 *   系统会自动将该行作为 response。例如：
 *     console.log("3 5");  // 等价于 {"response": "3 5"}
 *   注意：简化模式下无法使用持久化数据和调试信息。
 * ========================================================================
 */

import { createInterface } from "readline";

/** Bot 输入类型 */
interface BotInput {
  requests: string[];    // 历史请求列表
  responses: string[];   // 历史响应列表
  data: string;          // 本局持久化数据
  globaldata: string;    // 全局持久化数据
  timeLimit: number;     // 时间限制（秒）
  memoryLimit: number;   // 内存限制（MB）
}

/** Bot 输出类型 */
interface BotOutput {
  response: string;      // 必填：本轮回复
  debug?: string;        // 可选：调试信息
  data?: string;         // 可选：本局持久化
  globaldata?: string;   // 可选：跨对局持久化
}

/**
 * 决策函数 — 在此实现你的策略逻辑
 *
 * @param currentRequest 本轮裁判发来的请求
 * @param requests       完整历史请求列表
 * @param responses      完整历史响应列表
 * @param data           本局持久化数据（上轮保存的，首轮为空字符串）
 * @returns 你的回复字符串
 */
function makeDecision(
  currentRequest: string,
  requests: string[],
  responses: string[],
  data: string,
): string {
  // ====== 示例：随机选择一个方向 ======
  // 假设游戏需要输出 0~3 的方向
  const direction = Math.floor(Math.random() * 4);
  return String(direction);
}

async function readInput(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.on("line", (line: string) => {
      rl.close();
      resolve(line);
    });
  });
}

async function main(): Promise<void> {
  // 读取完整输入（单行 JSON）
  const inputStr = await readInput();
  const input: BotInput = JSON.parse(inputStr);

  // 解析各字段
  const { requests, responses, data, globaldata } = input;

  // 获取本轮裁判请求（requests 数组的最后一个元素）
  const currentRequest = requests[requests.length - 1];

  // 调用决策函数
  const myResponse = makeDecision(currentRequest, requests, responses, data);

  // 持久化数据示例：记录总轮次
  const turnCount = data ? parseInt(data, 10) + 1 : 1;

  // 构造输出 JSON
  const output: BotOutput = {
    response: myResponse,                    // 必填：本轮回复
    debug: `turn ${turnCount}`,              // 可选：调试信息
    data: String(turnCount),                 // 可选：本局持久化
    // globaldata: "全局状态",               // 可选：跨对局持久化
  };

  console.log(JSON.stringify(output));
}

main();

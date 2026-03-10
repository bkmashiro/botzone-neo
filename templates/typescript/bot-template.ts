/**
 * Botzone TypeScript Bot 模板
 *
 * 交互协议：
 * - stdin: 完整 JSON 对象
 *   - requests:   string[]  历史请求列表
 *   - responses:  string[]  历史响应列表
 *   - data:       string    本局持久化数据
 *   - globaldata: string    全局持久化数据
 * - stdout: 单行 JSON 对象
 *   - response:   string    本轮回复（必填）
 *   - debug?:     string    调试信息
 *   - data?:      string    本局持久化数据
 *   - globaldata?: string   全局持久化数据
 */

import { createInterface } from "readline";

/** Bot 输入类型 */
interface BotInput {
  requests: string[];
  responses: string[];
  data: string;
  globaldata: string;
  timeLimit: number;
  memoryLimit: number;
}

/** Bot 输出类型 */
interface BotOutput {
  response: string;
  debug?: string;
  data?: string;
  globaldata?: string;
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
  const inputStr = await readInput();
  const input: BotInput = JSON.parse(inputStr);

  const { requests, responses, data, globaldata } = input;

  // 获取本轮裁判请求
  const currentRequest = requests[requests.length - 1];

  // ====== 在此编写你的策略逻辑 ======
  // 示例：原样返回请求内容
  const myResponse = currentRequest;

  // 持久化数据示例
  const turnCount = data ? parseInt(data, 10) + 1 : 1;
  // ====== 策略逻辑结束 ======

  const output: BotOutput = {
    response: myResponse,
    // debug: "调试信息",
    data: String(turnCount),
    // globaldata: "全局数据",
  };

  console.log(JSON.stringify(output));
}

main();

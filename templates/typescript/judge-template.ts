/**
 * Botzone TypeScript Judge（裁判）模板
 *
 * 裁判程序负责：
 * 1. 首轮：接收 initdata，向各 Bot 发送初始请求
 * 2. 中间轮：接收各 Bot 的回复，判定并发送下一轮请求
 * 3. 最终轮：判定对局结束，输出各 Bot 得分
 *
 * 输出格式（单行 JSON）：
 * {
 *   "command": "request" | "finish",
 *   "content": { "0": "...", "1": "..." },
 *   "display": { ... }
 * }
 */

import { createInterface } from "readline";

interface JudgeInput {
  requests: string[];
  responses: string[];
  data: string;
  globaldata: string;
}

interface JudgeOutput {
  command: "request" | "finish";
  content: Record<string, string | number>;
  display: string | object;
  initdata?: string | object;
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
  const input: JudgeInput = JSON.parse(inputStr);

  const { requests, responses } = input;
  const roundNum = responses.length;

  let output: JudgeOutput;

  if (roundNum === 0) {
    // ====== 首轮：解析 initdata，发送初始请求 ======
    const initdata = requests[0];
    output = {
      command: "request",
      content: { "0": initdata, "1": initdata },
      display: { round: 1, info: "对局开始" },
    };
  } else {
    // 解析上轮各 Bot 的回复
    const lastResponses = JSON.parse(requests[requests.length - 1]) as Record<
      string,
      string
    >;

    // ====== 在此编写裁判逻辑 ======
    if (roundNum >= 3) {
      // 示例：3 轮后结束
      output = {
        command: "finish",
        content: { "0": 1, "1": 0 },
        display: { round: roundNum, info: "对局结束" },
      };
    } else {
      // 交换对手回复作为下一轮请求
      const resp0 = lastResponses["0"] ?? "";
      const resp1 = lastResponses["1"] ?? "";
      output = {
        command: "request",
        content: { "0": resp1, "1": resp0 },
        display: { round: roundNum + 1 },
      };
    }
    // ====== 裁判逻辑结束 ======
  }

  console.log(JSON.stringify(output));
}

main();

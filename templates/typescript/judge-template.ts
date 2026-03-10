/**
 * Botzone TypeScript Judge（裁判）模板
 *
 * 裁判程序负责控制对局流程：
 * 1. 首轮（round=0）：接收 initdata，生成初始数据，向各 Bot 发送初始请求
 * 2. 中间轮：接收各 Bot 的回复，判定并发送下一轮请求
 * 3. 最终轮：判定对局结束，输出各 Bot 得分
 *
 * 交互协议：
 * - stdin: JSON 对象
 *   - requests:  string[]  历史数据（首轮 requests[0] = initdata）
 *   - responses: string[]  历史数据（裁判自己之前的输出列表）
 * - stdout: 单行 JSON 对象
 *   - command:   "request" | "finish"
 *   - content:   object
 *     - request 时: {"0": "发给Bot0的请求", "1": "发给Bot1的请求", ...}
 *     - finish 时:  {"0": 得分, "1": 得分, ...}（0~2，支持平局）
 *   - display:   object   前端展示用的额外数据（对局回放时可见）
 *   - initdata?: string   仅首轮可选，由裁判生成的初始数据（如随机种子）
 *
 * 运行：tsc judge-template.ts && node judge-template.js
 */

import { createInterface } from "readline";

/** 裁判输入类型 */
interface JudgeInput {
  requests: string[];    // 历史数据
  responses: string[];   // 历史数据
  data: string;          // 持久化数据
  globaldata: string;    // 全局数据
}

/** 裁判输出类型 */
interface JudgeOutput {
  command: "request" | "finish";                 // 指令类型
  content: Record<string, string | number>;      // 各 Bot 的请求或得分
  display: Record<string, unknown>;              // 前端展示数据
  initdata?: string;                             // 仅首轮：裁判生成的初始数据
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
  // 读取输入
  const inputStr = await readInput();
  const input: JudgeInput = JSON.parse(inputStr);

  const { requests, responses } = input;

  // 当前轮次 = 已有的 responses 数量
  // roundNum=0 表示首轮（尚无 Bot 回复），roundNum>=1 表示已收到 Bot 回复
  const roundNum = responses.length;

  let output: JudgeOutput;

  if (roundNum === 0) {
    // ====== 首轮：解析 initdata，生成初始数据 ======
    let initdata = requests[0]; // 由提交任务时传入的 initdata

    // 如果 initdata 为空，裁判自行生成（例如随机种子）
    if (!initdata) {
      initdata = String(Math.floor(Math.random() * 2147483647));
    }

    // 用 initdata 初始化游戏状态（示例：生成棋盘、地图等）
    output = {
      command: "request",
      content: { "0": initdata, "1": initdata }, // 向两个 Bot 发送初始请求
      display: { round: 1, info: "对局开始" },
      initdata,                                    // 保存 initdata（首轮专用）
    };
  } else {
    // ====== 中间轮 / 最终轮 ======
    // requests 最后一个元素是上轮各 Bot 的回复汇总
    const lastResponses = JSON.parse(
      requests[requests.length - 1],
    ) as Record<string, string>;

    const resp0 = lastResponses["0"] ?? ""; // Bot 0 的回复
    const resp1 = lastResponses["1"] ?? ""; // Bot 1 的回复

    // ====== 在此编写裁判逻辑 ======
    // 示例：5 轮后结束对局，Bot 0 获胜
    if (roundNum >= 5) {
      // 结束对局：content 为各 Bot 的得分
      // 得分范围 0~2：胜=2, 平=1, 负=0
      output = {
        command: "finish",
        content: { "0": 2, "1": 0 },
        display: { round: roundNum, info: "对局结束", winner: 0 },
      };
    } else {
      // 继续对局：交换对手回复作为下一轮请求
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

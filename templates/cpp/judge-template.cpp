/**
 * Botzone C++ Judge（裁判）模板
 *
 * 裁判程序负责：
 * 1. 首轮：接收 initdata，向各 Bot 发送初始请求
 * 2. 中间轮：接收各 Bot 的回复，判定并发送下一轮请求
 * 3. 最终轮：判定对局结束，输出各 Bot 得分
 *
 * 输出格式（单行 JSON）：
 * {
 *   "command": "request" | "finish",
 *   "content": { "0": "...", "1": "..." },  // request 时为各 Bot 的请求，finish 时为得分
 *   "display": { ... }                       // 前端展示数据
 * }
 */

#include <iostream>
#include <string>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

int main() {
    // 读取输入
    string inputStr;
    getline(cin, inputStr);
    json input = json::parse(inputStr);

    auto requests = input["requests"].get<vector<string>>();
    auto responses = input["responses"].get<vector<string>>();

    int round = static_cast<int>(responses.size());

    json output;
    output["display"] = json::object();

    if (round == 0) {
        // ====== 首轮：解析 initdata，发送初始请求 ======
        string initdata = requests[0];
        // 示例：向两个 Bot 发送初始请求
        output["command"] = "request";
        output["content"] = {{"0", initdata}, {"1", initdata}};
        output["display"] = {{"round", 1}, {"info", "对局开始"}};
    } else {
        // 解析上轮各 Bot 的回复
        json lastResponses = json::parse(requests.back());

        // ====== 在此编写裁判逻辑 ======
        // 示例：3 轮后结束
        if (round >= 3) {
            output["command"] = "finish";
            output["content"] = {{"0", 1}, {"1", 0}};  // Bot 0 获胜
            output["display"] = {{"round", round}, {"info", "对局结束"}};
        } else {
            output["command"] = "request";
            // 将对手的回复作为下一轮请求
            string resp0 = lastResponses.value("0", "");
            string resp1 = lastResponses.value("1", "");
            output["content"] = {{"0", resp1}, {"1", resp0}};
            output["display"] = {{"round", round + 1}};
        }
        // ====== 裁判逻辑结束 ======
    }

    cout << output.dump() << endl;
    return 0;
}

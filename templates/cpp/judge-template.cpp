/**
 * Botzone C++ Judge（裁判）模板
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
 *   - initdata:  string   仅首轮可选，由裁判生成的初始数据（如随机种子）
 *
 * 编译：g++ -O2 -std=c++17 judge.cpp -o judge
 */

#include <iostream>
#include <string>
#include <cstdlib>
#include <ctime>
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

    // 当前轮次 = 已有的 responses 数量
    // round=0 表示首轮（尚无 Bot 回复），round>=1 表示已收到 Bot 回复
    int round = static_cast<int>(responses.size());

    json output;
    output["display"] = json::object();

    if (round == 0) {
        // ====== 首轮：解析 initdata，生成初始数据 ======
        string initdata = requests[0];  // 由提交任务时传入的 initdata

        // 如果 initdata 为空，裁判自行生成（例如随机种子）
        if (initdata.empty()) {
            srand(static_cast<unsigned>(time(nullptr)));
            initdata = to_string(rand());
        }

        // 用 initdata 初始化游戏状态（示例：生成棋盘、地图等）
        // 这里假设直接把 initdata 作为初始请求发给两个 Bot

        output["command"] = "request";
        output["content"] = {{"0", initdata}, {"1", initdata}};  // 向两个 Bot 发送初始请求
        output["initdata"] = initdata;                            // 保存 initdata（首轮专用）
        output["display"] = {{"round", 1}, {"info", "对局开始"}};
    } else {
        // ====== 中间轮 / 最终轮 ======
        // requests.back() 是上一轮各 Bot 的回复汇总（JSON 对象: {"0": "...", "1": "..."}）
        json lastResponses = json::parse(requests.back());

        string resp0 = lastResponses.value("0", "");  // Bot 0 的回复
        string resp1 = lastResponses.value("1", "");  // Bot 1 的回复

        // ====== 在此编写裁判逻辑 ======
        // 示例：5 轮后结束对局，Bot 0 获胜
        if (round >= 5) {
            // 结束对局：content 为各 Bot 的得分
            // 得分范围 0~2：胜=2, 平=1, 负=0（也可用 1/0 表示胜/负）
            output["command"] = "finish";
            output["content"] = {{"0", 2}, {"1", 0}};
            output["display"] = {
                {"round", round},
                {"info", "对局结束"},
                {"winner", 0}
            };
        } else {
            // 继续对局：交换对手回复作为下一轮请求
            output["command"] = "request";
            output["content"] = {{"0", resp1}, {"1", resp0}};
            output["display"] = {{"round", round + 1}};
        }
        // ====== 裁判逻辑结束 ======
    }

    cout << output.dump() << endl;
    return 0;
}

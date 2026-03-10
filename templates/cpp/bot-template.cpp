/**
 * Botzone C++ Bot 模板
 *
 * 交互协议（完整 JSON 模式）：
 * - stdin: 完整 JSON 对象，包含以下字段：
 *   - requests:   string[]  历史请求列表（裁判发给你的指令）
 *   - responses:  string[]  历史响应列表（你之前的回复）
 *   - data:       string    本局持久化数据（上轮你保存的，首轮为空）
 *   - globaldata: string    全局持久化数据（跨对局共享）
 * - stdout: 单行 JSON 对象：
 *   - response:   string    本轮回复（必填）
 *   - debug:      string    调试信息（可选，不影响对局，仅开发者可见）
 *   - data:       string    本局持久化数据（可选，下轮会原样传回）
 *   - globaldata: string    全局持久化数据（可选，跨对局保留）
 *
 * 依赖：nlohmann/json（沙箱内已预装于 /usr/local/include/nlohmann/json.hpp）
 * 编译：g++ -O2 -std=c++17 bot.cpp -o bot
 *
 * ========================================================================
 * 简化交互模式（替代写法）：
 *   如果你不需要 data/globaldata/debug，可以让 stdout 首行输出纯文本，
 *   系统会自动将该行作为 response。例如：
 *     cout << "3 5" << endl;  // 等价于 {"response": "3 5"}
 *   注意：简化模式下无法使用持久化数据和调试信息。
 * ========================================================================
 */

#include <iostream>
#include <string>
#include <sstream>
#include <cstdlib>
#include <ctime>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

/**
 * 决策函数 — 在此实现你的策略逻辑
 *
 * @param currentRequest 本轮裁判发来的请求（字符串，具体格式取决于游戏）
 * @param requests       完整历史请求列表
 * @param responses      完整历史响应列表
 * @param data           本局持久化数据（上轮保存的，首轮为空字符串）
 * @return               你的回复字符串
 */
string makeDecision(const string& currentRequest,
                    const vector<string>& requests,
                    const vector<string>& responses,
                    const string& data) {
    // ====== 示例：随机选择一个方向 ======
    // 假设游戏需要输出 0~3 的方向
    srand(static_cast<unsigned>(time(nullptr)));
    int direction = rand() % 4;
    return to_string(direction);
}

int main() {
    // 读取完整输入（单行 JSON）
    string inputStr;
    getline(cin, inputStr);
    json input = json::parse(inputStr);

    // 解析各字段
    auto requests = input["requests"].get<vector<string>>();   // 历史请求列表
    auto responses = input["responses"].get<vector<string>>(); // 历史响应列表
    string data = input.value("data", "");                     // 本局持久化数据
    string globaldata = input.value("globaldata", "");         // 全局持久化数据

    // 获取本轮裁判请求（requests 数组的最后一个元素）
    string currentRequest = requests.back();

    // 调用决策函数
    string myResponse = makeDecision(currentRequest, requests, responses, data);

    // 持久化数据示例：记录总轮次
    int turnCount = data.empty() ? 1 : stoi(data) + 1;

    // 构造输出 JSON
    json output;
    output["response"] = myResponse;                           // 必填：本轮回复
    output["debug"] = "turn " + to_string(turnCount);          // 可选：调试信息
    output["data"] = to_string(turnCount);                     // 可选：本局持久化（下轮通过 data 字段传回）
    // output["globaldata"] = "全局状态";                       // 可选：跨对局持久化

    cout << output.dump() << endl;
    return 0;
}

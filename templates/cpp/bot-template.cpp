/**
 * Botzone C++ Bot 模板
 *
 * 交互协议：
 * - stdin: 完整 JSON 对象，包含以下字段：
 *   - requests:  string[]   历史请求列表（裁判发给你的指令）
 *   - responses: string[]   历史响应列表（你之前的回复）
 *   - data:      string     本局持久化数据（上轮你保存的）
 *   - globaldata: string    全局持久化数据（跨对局）
 * - stdout: 单行 JSON 对象：
 *   - response:  string     本轮回复（必填）
 *   - debug:     string     调试信息（可选，不影响对局）
 *   - data:      string     本局持久化数据（可选）
 *   - globaldata: string    全局持久化数据（可选）
 *
 * 依赖：nlohmann/json（位于 /usr/local/include/nlohmann/json.hpp）
 */

#include <iostream>
#include <string>
#include <nlohmann/json.hpp>

using json = nlohmann::json;
using namespace std;

int main() {
    // 读取完整输入
    string inputStr;
    getline(cin, inputStr);
    json input = json::parse(inputStr);

    // 解析历史
    auto requests = input["requests"].get<vector<string>>();
    auto responses = input["responses"].get<vector<string>>();
    string data = input.value("data", "");
    string globaldata = input.value("globaldata", "");

    // 获取本轮裁判请求（最后一个 request）
    string currentRequest = requests.back();

    // ====== 在此编写你的策略逻辑 ======
    // 示例：原样返回请求内容
    string myResponse = currentRequest;

    // ====== 策略逻辑结束 ======

    // 构造输出
    json output;
    output["response"] = myResponse;
    // output["debug"] = "调试信息";    // 可选
    // output["data"] = "保存的数据";   // 可选：本局持久化
    // output["globaldata"] = "全局数据"; // 可选：跨对局持久化

    cout << output.dump() << endl;
    return 0;
}

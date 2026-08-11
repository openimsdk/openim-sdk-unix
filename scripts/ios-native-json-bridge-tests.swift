import Foundation

@main
enum OpenIMNativeJSONBridgeTests {
    static func main() throws {
        try assertFraming(
            input: #"[{"clientMsgID":"first","sendTime":1},{"clientMsgID":"second","nested":{"enabled":true}}]"#,
            expectedObjects: [
                ["clientMsgID": "first", "sendTime": NSNumber(value: 1)],
                ["clientMsgID": "second", "nested": ["enabled": true]],
            ]
        )
        try assertFraming(input: "[]", expectedObjects: [])
        try assertRejected("{}")
        try assertRejected(#"[{"clientMsgID":"valid"},null]"#)
        try assertRejected(#"[{"clientMsgID":"valid"},"not-an-object"]"#)
        try assertRejected("not-json")
    }

    private static func assertFraming(
        input: String,
        expectedObjects: [[String: Any]]
    ) throws {
        guard let framed = OpenIMNativeJSONBridge.frameJSONObjectArray(input) else {
            throw TestFailure("expected framing to succeed for \(input)")
        }
        let lines = framed.isEmpty ? [] : framed.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        guard lines.count == expectedObjects.count else {
            throw TestFailure("expected \(expectedObjects.count) frames, received \(lines.count): \(framed)")
        }
        for (index, line) in lines.enumerated() {
            guard let data = line.data(using: .utf8),
                  let decoded = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  NSDictionary(dictionary: decoded).isEqual(to: expectedObjects[index]) else {
                throw TestFailure("frame \(index) is not the expected JSON object: \(line)")
            }
        }
    }

    private static func assertRejected(_ input: String) throws {
        guard OpenIMNativeJSONBridge.frameJSONObjectArray(input) == nil else {
            throw TestFailure("expected framing to reject \(input)")
        }
    }
}

private struct TestFailure: Error, CustomStringConvertible {
    let description: String

    init(_ description: String) {
        self.description = description
    }
}

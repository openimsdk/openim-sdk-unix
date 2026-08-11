import Foundation

enum OpenIMNativeJSONBridge {
    static func frameJSONObjectArray(_ data: String) -> String? {
        guard let source = data.data(using: .utf8),
              let rawItems = try? JSONSerialization.jsonObject(with: source, options: []),
              let items = rawItems as? [Any] else {
            return nil
        }

        var objectJSONList: [String] = []
        objectJSONList.reserveCapacity(items.count)
        for rawItem in items {
            guard let object = rawItem as? [String: Any],
                  JSONSerialization.isValidJSONObject(object),
                  let encoded = try? JSONSerialization.data(withJSONObject: object, options: []),
                  let itemJSON = String(data: encoded, encoding: .utf8) else {
                return nil
            }
            objectJSONList.append(itemJSON)
        }
        return objectJSONList.joined(separator: "\n")
    }
}

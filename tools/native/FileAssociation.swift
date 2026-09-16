import AppKit
import UniformTypeIdentifiers
import CoreServices

let args = CommandLine.arguments
 guard args.count >= 3, ["sfb", "sfzip"].contains(args[2]),
       let type = UTType(filenameExtension: args[2]) else { exit(2) }
if args[1] == "query" {
    let handler = LSCopyDefaultRoleHandlerForContentType(type.identifier as CFString, .all)?.takeRetainedValue()
    print(handler as String? ?? "")
} else if args[1] == "set", args.count == 4 {
    if #available(macOS 12.0, *) {
        NSWorkspace.shared.setDefaultApplication(at: URL(fileURLWithPath: args[3]), toOpen: type) { error in
            if let error = error {
                FileHandle.standardError.write(Data(error.localizedDescription.utf8))
                exit(1)
            }
            exit(0)
        }
        RunLoop.main.run()
    } else { exit(3) }
} else { exit(2) }

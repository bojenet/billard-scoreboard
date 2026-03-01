import Foundation
import PDFKit

struct Position: Codable {
    let id: String
    let set: String
    let number: Int
    let title: String
    let pdfPage: Int
    let description: String
    let discipline: String
    let difficulty: String
    let comments: [String]?
}

func clean(_ text: String) -> String {
    return text
        .replacingOccurrences(of: "\r", with: " ")
        .replacingOccurrences(of: "\n", with: " ")
        .replacingOccurrences(of: "\u{2028}", with: " ")
        .replacingOccurrences(of: "\u{2029}", with: " ")
        .split(separator: " ")
        .joined(separator: " ")
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

let cwd = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let pdfURL = cwd.appendingPathComponent("pdf/Conti_1_62.pdf")
let jsonURL = cwd.appendingPathComponent("data/roger_conti_positions.json")

guard let document = PDFDocument(url: pdfURL) else {
    fputs("PDF konnte nicht geladen werden: \(pdfURL.path)\n", stderr)
    exit(1)
}

let inputData = try Data(contentsOf: jsonURL)
let decoder = JSONDecoder()
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]

let positions = try decoder.decode([Position].self, from: inputData)

let commentsByPage: [Int: [String]] = Dictionary(uniqueKeysWithValues: (0..<document.pageCount).map { pageIndex in
    guard let page = document.page(at: pageIndex) else {
        return (pageIndex + 1, [])
    }
    var seen = Set<String>()
    var comments: [String] = []
    for annot in page.annotations {
        if annot.type == PDFAnnotationSubtype.popup.rawValue {
            continue
        }
        let text = clean(annot.contents ?? "")
        if text.isEmpty || seen.contains(text) {
            continue
        }
        seen.insert(text)
        comments.append(text)
    }
    return (pageIndex + 1, comments)
})

let merged = positions.map { pos in
    Position(
        id: pos.id,
        set: pos.set,
        number: pos.number,
        title: pos.title,
        pdfPage: pos.pdfPage,
        description: pos.description,
        discipline: pos.discipline,
        difficulty: pos.difficulty,
        comments: commentsByPage[pos.pdfPage] ?? []
    )
}

let out = try encoder.encode(merged)
try out.write(to: jsonURL)

let annotatedCount = merged.filter { !($0.comments ?? []).isEmpty }.count
print("Kommentare extrahiert für \(annotatedCount) von \(merged.count) Positionen.")

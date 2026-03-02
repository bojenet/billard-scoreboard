import Foundation
import PDFKit
import Vision
import AppKit
import CoreImage

struct OCRPage: Codable {
    let number: Int
    let pdfPage: Int
    let sourceText: String
}

struct OCRExport: Codable {
    let pdf: String
    let totalPages: Int
    let startNumber: Int
    let pages: [OCRPage]
}

func parseArgs() -> [String: String] {
    var out: [String: String] = [:]
    var i = 1
    let args = CommandLine.arguments
    while i < args.count {
        let key = args[i]
        if key.hasPrefix("--"), i + 1 < args.count {
            out[String(key.dropFirst(2))] = args[i + 1]
            i += 2
        } else {
            i += 1
        }
    }
    return out
}

func clean(_ text: String) -> String {
    text
        .replacingOccurrences(of: "\r", with: "\n")
        .replacingOccurrences(of: "\u{2028}", with: "\n")
        .replacingOccurrences(of: "\u{2029}", with: "\n")
        .replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func render(page: PDFPage, scale: CGFloat, crop: CGRect?) throws -> CGImage {
    let pageRect = page.bounds(for: .mediaBox)
    let targetSize = NSSize(width: pageRect.width * scale, height: pageRect.height * scale)
    let image = NSImage(size: targetSize)
    image.lockFocus()
    NSColor.white.set()
    NSBezierPath(rect: NSRect(origin: .zero, size: targetSize)).fill()
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.saveGState()
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    ctx.restoreGState()
    image.unlockFocus()

    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let fullCG = bitmap.cgImage else {
        throw NSError(domain: "ocr", code: 1, userInfo: [NSLocalizedDescriptionKey: "Render failed"])
    }

    if let crop {
        let rect = CGRect(
            x: CGFloat(fullCG.width) * crop.origin.x,
            y: CGFloat(fullCG.height) * crop.origin.y,
            width: CGFloat(fullCG.width) * crop.size.width,
            height: CGFloat(fullCG.height) * crop.size.height
        ).integral
        guard let cropped = fullCG.cropping(to: rect) else {
            throw NSError(domain: "ocr", code: 2, userInfo: [NSLocalizedDescriptionKey: "Crop failed"])
        }
        return cropped
    }

    return fullCG
}

func preprocess(_ image: CGImage) throws -> CGImage {
    let ciContext = CIContext(options: nil)
    let ciImage = CIImage(cgImage: image)
        .applyingFilter("CIPhotoEffectMono")
        .applyingFilter("CIColorControls", parameters: [
            kCIInputContrastKey: 1.35,
            kCIInputBrightnessKey: 0.02,
            kCIInputSaturationKey: 0.0
        ])
        .applyingFilter("CIUnsharpMask", parameters: [
            kCIInputRadiusKey: 1.2,
            kCIInputIntensityKey: 0.9
        ])

    guard let processed = ciContext.createCGImage(ciImage, from: ciImage.extent) else {
        throw NSError(domain: "ocr", code: 3, userInfo: [NSLocalizedDescriptionKey: "Preprocess failed"])
    }
    return processed
}

func recognize(_ image: CGImage) throws -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["fr-FR", "de-DE", "en-US"]
    request.minimumTextHeight = 0.012

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try handler.perform([request])
    let observations = request.results ?? []
    let lines = observations.compactMap {
        $0.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines)
    }.filter { !$0.isEmpty }
    return clean(lines.joined(separator: "\n"))
}

let args = parseArgs()
guard let pdfPath = args["pdf"], let outPath = args["out"] else {
    fputs("Usage: swift scripts/ocr_conti_pdf.swift --pdf <input.pdf> --out <output.json> [--start-number 63] [--start-page 2] [--crop 0.20,0.10,0.68,0.82] [--scale 4.0]\n", stderr)
    exit(1)
}

let startNumber = Int(args["start-number"] ?? "1") ?? 1
let startPage = Int(args["start-page"] ?? "1") ?? 1
let scale = CGFloat(Double(args["scale"] ?? "4.0") ?? 4.0)
let cropValues = (args["crop"] ?? "0.20,0.10,0.68,0.82").split(separator: ",").compactMap { Double($0) }
let crop: CGRect? = cropValues.count == 4 ? CGRect(x: cropValues[0], y: cropValues[1], width: cropValues[2], height: cropValues[3]) : nil

let pdfURL = URL(fileURLWithPath: pdfPath)
let outURL = URL(fileURLWithPath: outPath)

guard let pdf = PDFDocument(url: pdfURL) else {
    fputs("PDF konnte nicht geladen werden: \(pdfPath)\n", stderr)
    exit(1)
}

var pages: [OCRPage] = []
for idx in 0..<pdf.pageCount {
    guard let page = pdf.page(at: idx) else { continue }
    do {
        let rendered = try render(page: page, scale: scale, crop: crop)
        let processed = try preprocess(rendered)
        let text = try recognize(processed)
        let pdfPage = startPage + idx
        let number = startNumber + idx
        pages.append(OCRPage(number: number, pdfPage: pdfPage, sourceText: text))
        fputs("OCR page \(pdfPage) -> position \(number) done\n", stderr)
    } catch {
        fputs("OCR failed for page index \(idx): \(error.localizedDescription)\n", stderr)
        pages.append(OCRPage(number: startNumber + idx, pdfPage: startPage + idx, sourceText: ""))
    }
}

let export = OCRExport(pdf: pdfURL.lastPathComponent, totalPages: pdf.pageCount, startNumber: startNumber, pages: pages)
let encoder = JSONEncoder()
encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
let data = try encoder.encode(export)
try data.write(to: outURL)
print("Wrote \(pages.count) OCR pages to \(outURL.path)")

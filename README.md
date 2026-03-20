# Millimeter Wave Product PDF Extractor & Generator
A Node.js/React application that intelligently extracts information from Chinese millimeter wave product manuals , transforms the content into standardized English PDFs with custom naming conventions, and adheres to professional template requirements for headers, footers, and core sections.

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation & Usage](#installation--usage)
- [Customization Guide](#customization-guide)
- [Troubleshooting](#troubleshooting)

## Features
1. **Adaptive Content Extraction**: Extracts product parameters, application scenarios, performance descriptions, and advantages (no performance curves required) from Chinese PDF manuals.
2. **English-Only Output**: Converts all extracted content to English and eliminates garbled characters caused by font limitations.
3. **Custom Naming Convention**: Automatically changes the first letter of product names/IDs to "O" (e.g., LR-T14 → OR-T14) and enforces consistency across the PDF.
4. **Template Compliance**: Maintains strict adherence to professional templates for headers, footers, Features, and Description sections.
5. **Layout Optimization**: Prevents text overlap with footers by dynamically adjusting text block positioning/font size; fixes symbol rendering and table text spacing issues.
6. **Image Handling**: Extracts and embeds application scenario images (instead of performance curves) into the generated PDF.

## Prerequisites
- Node.js (v16+ recommended)
- Gemini API Key (for content extraction/translation)
- npm (included with Node.js)

## Installation & Usage
### Step 1: Clone the Repository
```bash
git clone https://github.com/your-username/millimeter-wave-pdf-generator.git
cd millimeter-wave-pdf-generator
```

### Step 2: Install Dependencies
```bash
npm install
```

### Step 3: Configure Environment Variables
1. Create a `.env.local` file in the root directory:
   ```bash
   touch .env.local
   ```
2. Add your Gemini API key to the file:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

### Step 4: Run the Application
```bash
npm run dev
```
3. Access the app via your browser (typically at `http://localhost:3000`), upload a Chinese millimeter wave product PDF , and generate the standardized English PDF.

## Customization Guide
Below is a detailed guide to modifying the app’s functionality—all changes target the core file `index.tsx` (unless specified otherwise).

### 1. Modify Product Naming Convention
**Goal**: Change the prefix from "O" to another letter (e.g., "X") or adjust the naming logic.
**Steps**:
- Locate the product name transformation function in `index.tsx` (search for "first letter to O" or "LR-T14 → OR-T14").
- Modify the regex/string manipulation logic:
  ```typescript
  // Original code (changes first letter to O)
  const transformProductName = (name: string) => {
    if (!name) return name;
    return 'O' + name.slice(1);
  };

  // Modified code (changes first letter to X)
  const transformProductName = (name: string) => {
    if (!name) return name;
    return 'X' + name.slice(1);
  };
  ```
- Update the Gemini prompt (in the AI extraction section) to reflect the new naming rule (search for "change the first letter of all product IDs and names to 'O'").

### 2. Adjust Description Section Content/Layout
#### A. Modify Text Length Limits
**Goal**: Change the 150-word limit for descriptions or 8-item limit for features.
**Steps**:
- Locate the Gemini prompt in `index.tsx` (search for "limit descriptions to 150 words and features to 8 items").
- Adjust the limits in the prompt text:
  ```typescript
  // Original prompt snippet
  "limit descriptions to 150 words and features to 8 items"

  // Modified snippet (200 words, 10 features)
  "limit descriptions to 200 words and features to 10 items"
  ```
- Update the dynamic layout calculation logic (search for "pre-calculates the height of the Description text block") to adjust font size/positioning thresholds if needed.

#### B. Fix Footer Overlap (Advanced)
**Goal**: Adjust how the app handles long Description text (e.g., change upward movement distance or font size scaling).
**Steps**:
- Locate the layout calculation code (search for "Adaptive Positioning" or "Intelligent Scaling").
- Modify the vertical offset (e.g., from 20 to 30 pixels) or font size reduction factor:
  ```typescript
  // Original code (move up 20px if overlapping)
  const descriptionY = hasOverlap ? 150 - 20 : 150;

  // Modified code (move up 30px)
  const descriptionY = hasOverlap ? 150 - 30 : 150;

  // Original font size (reduce to 10px if overlapping)
  const descriptionFontSize = hasOverlap ? 10 : 12;

  // Modified font size (reduce to 9px)
  const descriptionFontSize = hasOverlap ? 9 : 12;
  ```

### 3. Update Symbol Rendering
**Goal**: Add/modify symbol replacements (e.g., add "°F" or change "Ohm" back to "Ω").
**Steps**:
- Locate the `sanitizeText` function in `index.tsx` (search for "ASCII Equivalents" or "≤ → <=").
- Modify the symbol mapping:
  ```typescript
  // Original sanitizeText function
  const sanitizeText = (text: string) => {
    return text
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      .replace(/Ω/g, "Ohm")
      .replace(/µ/g, "u")
      .replace(/±/g, "+/-");
  };

  // Modified (add °F support, change Ω back to Ω with custom font)
  const sanitizeText = (text: string) => {
    return text
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      .replace(/Ω/g, "Ω") // Use Ω if your font supports it
      .replace(/µ/g, "u")
      .replace(/±/g, "+/-")
      .replace(/°F/g, "°F"); // Add Fahrenheit support
  };
  ```
- If reintroducing symbols like "Ω", ensure the PDF font (in jsPDF configuration) supports Unicode characters (e.g., use `'Helvetica'` or a custom font).

### 4. Modify Table Layout/Spacing
**Goal**: Fix table text overflow or adjust alignment/spacing.
**Steps**:
- Locate the table generation code (search for "charSpace: 0" or "halign: 'left'").
- Adjust table properties:
  ```typescript
  // Original table config
  const tableConfig = {
    margins: { top: 20, bottom: 10 },
    body: tableData,
    styles: {
      charSpace: 0,
      halign: 'left',
      fontSize: 10,
    },
    columnStyles: {
      0: { width: 60 }, // Parameter column
      1: { width: 80 }, // Value column
    },
  };

  // Modified (widen Parameter column, change alignment to center)
  const tableConfig = {
    margins: { top: 20, bottom: 10 },
    body: tableData,
    styles: {
      charSpace: 0,
      halign: 'center', // Change alignment
      fontSize: 10,
    },
    columnStyles: {
      0: { width: 80 }, // Widen column to prevent overflow
      1: { width: 80 },
    },
  };
  ```

### 5. Add/Remove PDF Sections
**Goal**: Re-add the "Mechanical Outline" section (removed per requirements) or add a new section (e.g., "Certifications").
#### Re-add "Mechanical Outline":
- Locate the PDF generation logic (search for "Mechanical Outline section has been completely removed").
- Re-insert the section into the PDF draw sequence:
  ```typescript
  // Add this code where sections are drawn (e.g., after Features)
  doc.setFontSize(14);
  doc.text('Mechanical Outline', 20, mechanicalOutlineY);
  doc.setFontSize(10);
  // Add mechanical outline content (text/images) here
  doc.text('Dimensions: 100mm x 50mm x 20mm', 20, mechanicalOutlineY + 15);
  ```
#### Add a New "Certifications" Section:
- Define the section position (calculate Y-coordinate to avoid overlap).
- Add the section to the PDF draw logic:
  ```typescript
  // After Description section
  const certificationsY = descriptionY + descriptionHeight + 20;
  doc.setFontSize(14);
  doc.text('Certifications', 20, certificationsY);
  doc.setFontSize(10);
  doc.text('CE, FCC, RoHS', 20, certificationsY + 15);
  ```

### 6. Adjust Image Handling (Application Scenarios)
**Goal**: Change how application scenario images are cropped/embedded (e.g., resize images or limit the number of images).
**Steps**:
- Locate the image processing pipeline (search for "application scene crops" or "image processing pipeline").
- Modify image size/quantity limits:
  ```typescript
  // Original code (resize to 200x150)
  const resizedImage = await resizeImage(image, 200, 150);

  // Modified code (resize to 180x120)
  const resizedImage = await resizeImage(image, 180, 120);

  // Add limit for number of images (e.g., max 3)
  const maxImages = 3;
  const filteredImages = applicationSceneImages.slice(0, maxImages);
  ```

## Troubleshooting
### 1. "Document size exceeds supported limit" Error
- **Issue**: Uploaded PDF is larger than Gemini’s size limit (52428800 bytes).
- **Fix**: Compress the PDF (e.g., using online tools like SmallPDF) before upload, or split large PDFs into smaller files.

### 2. Garbled Characters in PDF
- **Issue**: Non-ASCII characters not sanitized properly.
- **Fix**: Verify the `sanitizeText` function in `index.tsx` covers all problematic characters; ensure all hardcoded text in the PDF template is in English.

### 3. Table Text Overflow
- **Issue**: Extra spaces between letters or long text exceeding column width.
- **Fix**: Confirm `charSpace: 0` is set in table styles; widen columns (in `columnStyles`) or enable automatic line breaking for table cells.

### 4. Footer Overlap
- **Issue**: Description text overlaps with footer content.
- **Fix**: Increase the upward offset (in dynamic layout code) or reduce the maximum text length in the Gemini prompt; verify font size scaling logic is working.

## License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments
- Powered by Google Gemini API for content extraction/translation.
- Built with React and jsPDF for PDF generation.
- Optimized for millimeter wave product manuals (Qingyuan Forum Product Manual format).

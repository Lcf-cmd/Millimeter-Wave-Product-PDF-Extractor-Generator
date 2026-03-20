
import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// PDF.js worker setup
// @ts-ignore
const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

type AssetRole = 'main' | 'outline' | 'curve' | 'none';

interface ManualAsset {
  id: string;
  file: File;
  preview: string;
  role: AssetRole;
}

interface BatchItem {
  id: string;
  pdf: File;
  relativePath: string;
  assets: ManualAsset[];
  status: 'pending' | 'processing' | 'done' | 'error';
  error?: string;
}

interface TableData {
  title: string;
  headers: string[];
  rows: string[][];
}

interface ExtractionResult {
  productId: string;
  productName: string;
  description: string;
  features: string[];
  specsTable?: TableData;
  environmentalParams?: TableData;
  absoluteMaxRatings?: TableData;
  truthTable?: TableData;
  imageBoxes?: {
    main?: { page: number; box: [number, number, number, number] };
    outline?: { page: number; box: [number, number, number, number] };
    curves?: { page: number; box: [number, number, number, number] }[];
    applicationScenes?: { page: number; box: [number, number, number, number] }[];
  };
}

const App = () => {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [isBatchMode, setIsBatchMode] = useState(false);
  
  const [logo, setLogo] = useState<string | null>(localStorage.getItem('logo_png'));
  const [bottomImg, setBottomImg] = useState<string | null>(localStorage.getItem('bottom_png'));

  const [rawPdfs, setRawPdfs] = useState<File[]>([]);
  const [rawImages, setRawImages] = useState<File[]>([]);
  const [batchQueue, setBatchQueue] = useState<BatchItem[]>([]);
  const [singleAssets, setSingleAssets] = useState<ManualAsset[]>([]);

  const getNormalizedSubPath = (file: File, isPdf: boolean = false) => {
    const fullPath = (file as any).webkitRelativePath || file.name;
    const segments = fullPath.split('/');
    if (segments.length > 1) segments.shift(); 
    
    let path = segments.join('/');
    if (isPdf) {
      return path.replace(/\.pdf$/i, '');
    } else {
      segments.pop(); 
      return segments.join('/');
    }
  };

  useEffect(() => {
    if (rawPdfs.length > 0) {
      const newQueue: BatchItem[] = rawPdfs.map(pdf => {
        const pdfSubPath = getNormalizedSubPath(pdf, true);
        const matchedImages = rawImages.filter(img => {
          const imgParentPath = getNormalizedSubPath(img, false);
          return imgParentPath === pdfSubPath;
        });

        const assets: ManualAsset[] = matchedImages.map(img => {
          const name = img.name.toLowerCase();
          let role: AssetRole = 'curve';
          if (name.includes('main')) role = 'main';
          else if (name.includes('outline')) role = 'outline';
          return {
            id: Math.random().toString(36).substr(2, 9),
            file: img,
            preview: URL.createObjectURL(img),
            role
          };
        });

        return {
          id: Math.random().toString(36).substr(2, 9),
          pdf,
          relativePath: pdfSubPath,
          assets,
          status: 'pending'
        };
      });
      setBatchQueue(newQueue);
    }
  }, [rawPdfs, rawImages]);

  const handlePersistentAsset = (e: React.ChangeEvent<HTMLInputElement>, key: string, setter: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        localStorage.setItem(key, base64);
        setter(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePdfFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const pdfs = Array.from(files).filter((f: any) => f.name.toLowerCase().endsWith('.pdf')) as File[];
    setRawPdfs(pdfs);
  };

  const handleImageFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const imgs = Array.from(files).filter((f: any) => /\.(png|jpe?g)$/i.test(f.name)) as File[];
    setRawImages(imgs);
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const extractPagesAsImages = async (pdfFile: File): Promise<string[]> => {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    // 限制 8 页以防负载过大
    for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 略微降低缩放以平衡内存
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85));
    }
    return images;
  };

  const cropImage = (base64: string, box: any): Promise<string | null> => {
    return new Promise((resolve) => {
      if (!box || !Array.isArray(box) || box.length !== 4) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const [ymin, xmin, ymax, xmax] = box;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const width = (xmax - xmin) * img.width / 1000;
        const height = (ymax - ymin) * img.height / 1000;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, (xmin * img.width / 1000), (ymin * img.height / 1000), width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = base64;
    });
  };

  const sanitizeText = (text: string) => {
    if (!text) return "";
    return text
      .replace(/℃/g, '°C').replace(/uA/g, 'uA').replace(/OHM/gi, 'Ohm')
      .replace(/±/g, '+/-').replace(/≤/g, '<=').replace(/≥/g, '>=')
      .replace(/Ω/g, 'Ohm').replace(/µ/g, 'u')
      .replace(/[^\x00-\x7F°]/g, '') // Keep degree symbol, remove others that cause issues
      .replace(/[ \t]+/g, ' ').replace(/[\r\v\f]/g, '').trim();
  };

  const cleanDescription = (text: string) => {
    if (!text) return "";
    return text
      .replace(/\*\*/g, '')
      .replace(/Description[:：]/i, '')
      .replace(/#{1,6}\s?/g, '')
      .replace(/`{1,3}/g, '')
      .replace(/^[ \t\n\*•-]+/gm, '')
      .replace(/\s+/g, ' ')
      .replace(/\n{2,}/g, '\n\n')
      .trim();
  };

  const runSynthesis = async (pdfFile: File, assets: ManualAsset[]) => {
    const pageImages = await extractPagesAsImages(pdfFile);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const parts = [
      { text: `TASK: Extract Product Specs for RFecho and TRANSLATE ALL CONTENT TO ENGLISH.
      - productId, productName: IMPORTANT: Change the first letter of the product ID and product name to 'O'. For example, 'LR-T14' becomes 'OR-T14'.
      - description: A CONCISE comprehensive description (MAX 150 words) including product introduction, performance, advantages, and application scenes. Combine all these into a well-structured text. 
        IMPORTANT: 
        1. TRANSLATE everything to English.
        2. Ensure any mention of the product name in this text also uses the new name (starting with 'O').
      - features: List of key features (MAX 8 items). 
        IMPORTANT: 
        1. TRANSLATE everything to English.
        2. Ensure any mention of the product name in these features also uses the new name (starting with 'O').
      - imageBoxes:
        - main: The main product photo.
        - outline: The mechanical outline drawing.
        - curves: Any performance curves/graphs.
        - applicationScenes: Images showing the product in use (application scenarios).
      - Tables: specsTable, environmentalParams, absoluteMaxRatings. 
        IMPORTANT: 
        1. TRANSLATE all headers and row content to English.
        2. Ensure any mention of the product name in table titles or content also uses the new name (starting with 'O').
      
      CRITICAL: The final output MUST be entirely in English. Do not include any Chinese characters in the JSON response.` }
    ];
    pageImages.forEach(img => parts.push({ inlineData: { mimeType: "image/jpeg", data: img.split(',')[1] } } as any));

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{ parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            productId: { type: Type.STRING },
            productName: { type: Type.STRING },
            description: { type: Type.STRING },
            features: { type: Type.ARRAY, items: { type: Type.STRING } },
            specsTable: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            environmentalParams: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            absoluteMaxRatings: { type: Type.OBJECT, properties: { title: { type: Type.STRING }, headers: { type: Type.ARRAY, items: { type: Type.STRING } }, rows: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.STRING } } } } },
            imageBoxes: {
              type: Type.OBJECT,
              properties: {
                main: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                outline: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                curves: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } } },
                applicationScenes: { type: Type.ARRAY, items: { type: Type.OBJECT, properties: { page: { type: Type.NUMBER }, box: { type: Type.ARRAY, items: { type: Type.NUMBER } } } } }
              }
            }
          },
          required: ["productId", "description", "features"]
        }
      }
    });

    const data: ExtractionResult = JSON.parse(response.text);

    // 顺序化处理 Base64 转换以防内存崩溃
    const processAssetsSequentially = async (role: AssetRole) => {
      const list = assets.filter(a => a.role === role);
      const results: string[] = [];
      for (const item of list) {
        results.push(await fileToBase64(item.file));
      }
      return results;
    };

    let finalMains = await processAssetsSequentially('main');
    let finalOutlines = await processAssetsSequentially('outline');
    let finalCurves = await processAssetsSequentially('curve');
    let finalScenes: string[] = [];

    // 补充裁剪图片
    if (finalMains.length === 0 && data.imageBoxes?.main) {
      const main = await cropImage(pageImages[data.imageBoxes.main.page - 1] || pageImages[0], data.imageBoxes.main.box);
      if (main) finalMains.push(main);
    }
    if (finalOutlines.length === 0 && data.imageBoxes?.outline) {
      const outline = await cropImage(pageImages[data.imageBoxes.outline.page - 1] || pageImages[0], data.imageBoxes.outline.box);
      if (outline) finalOutlines.push(outline);
    }
    if (finalCurves.length === 0 && data.imageBoxes?.curves) {
      for (const item of (data.imageBoxes.curves || [])) {
        const curve = await cropImage(pageImages[item.page - 1] || pageImages[0], item.box);
        if (curve) finalCurves.push(curve);
      }
    }
    if (data.imageBoxes?.applicationScenes) {
      for (const item of (data.imageBoxes.applicationScenes || [])) {
        const scene = await cropImage(pageImages[item.page - 1] || pageImages[0], item.box);
        if (scene) finalScenes.push(scene);
      }
    }

    generateFinalPDF(data, finalMains, finalOutlines, finalCurves, finalScenes);
  };

  const startBatchProcess = async () => {
    if (!logo || !localStorage.getItem('top_png') || !bottomImg) {
      alert("Please upload brand assets first.");
      return;
    }
    setProcessing(true);
    const updatedQueue = [...batchQueue];
    for (let i = 0; i < updatedQueue.length; i++) {
      const item = updatedQueue[i];
      if (item.status === 'done') continue;
      updatedQueue[i] = { ...item, status: 'processing' };
      setBatchQueue([...updatedQueue]);
      setProgress(`Processing ${i + 1}/${updatedQueue.length}: ${item.pdf.name}`);
      try {
        await runSynthesis(item.pdf, item.assets);
        updatedQueue[i] = { ...item, status: 'done' };
      } catch (err: any) {
        updatedQueue[i] = { ...item, status: 'error', error: err.message };
      }
      setBatchQueue([...updatedQueue]);
    }
    setProcessing(false);
    setProgress("Batch Complete");
  };

  const processSingle = async (file: File) => {
    setProcessing(true);
    setProgress("Analyzing...");
    try {
      await runSynthesis(file, singleAssets);
      setProgress("Done");
    } catch (err) {
      alert("Process failed");
    } finally {
      setProcessing(false);
    }
  };

  const generateFinalPDF = (data: ExtractionResult, mainImgs: string[], outlineImgs: string[], curves: string[], scenes: string[]) => {
    // @ts-ignore
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 18;

    // Helper to ensure naming rule
    const applyNamingRule = (text: string) => {
      if (!text) return text;
      // If it already starts with O, we assume it's already transformed or naturally starts with O
      // But the requirement is "将产品名称第一个字母改为O"
      // To be safe, we just replace the first character with 'O'
      return 'O' + text.substring(1);
    };

    const productId = applyNamingRule(data.productId);
    const productName = applyNamingRule(data.productName);

    const addHeaderFooter = () => {
      const hImg = localStorage.getItem('top_png');
      if (hImg) doc.addImage(hImg, 'PNG', 0, 0, pageWidth, 25);
      if (logo) {
        const props = doc.getImageProperties(logo);
        const ratio = props.width / props.height;
        const targetH = 13;
        const targetW = targetH * ratio;
        doc.addImage(logo, 'PNG', 10, 4, targetW, targetH);
      }
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("Product Datasheet", pageWidth - margin, 11, { align: 'right' });
      doc.setFontSize(10);
      doc.setTextColor(194, 140, 45); 
      doc.setFont("helvetica", "bold");
      doc.text(`ID: ${sanitizeText(productId)}`, pageWidth - margin, 18, { align: 'right' });
      if (bottomImg) doc.addImage(bottomImg, 'PNG', 0, pageHeight - 18, pageWidth, 18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      const fx = pageWidth - margin;
      const fstart = pageHeight - 12;
      doc.text("RFecho is trademark of Ocean Microwave", fx, fstart, { align: 'right' });
      doc.text("All rights reserved.", fx, fstart + 3.5, { align: 'right' });
      doc.text("©RFecho 2025", fx, fstart + 7, { align: 'right' });
      doc.text("www.rfecho.com", margin, pageHeight - 8);
    };

    const getImageDimensions = (imgBase64: string, maxW: number, maxH: number) => {
      const props = doc.getImageProperties(imgBase64);
      const ratio = props.width / props.height;
      let w = props.width * 0.264; let h = props.height * 0.264;
      if (w > maxW) { w = maxW; h = w / ratio; }
      if (h > maxH) { h = maxH; w = h * ratio; }
      return { w, h, ratio };
    };

    addHeaderFooter();
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    const titleText = productName || productId;
    const splitTitle = doc.splitTextToSize(sanitizeText(titleText), pageWidth - (margin * 2));
    doc.text(splitTitle, margin, 42);

    if (mainImgs.length > 0) {
      const areaY = 60;
      const areaMaxH = 95;
      const areaMaxW = pageWidth - (margin * 2);
      const count = mainImgs.length;
      if (count === 1) {
        const { w, h } = getImageDimensions(mainImgs[0], 130, areaMaxH);
        doc.addImage(mainImgs[0], 'PNG', (pageWidth - w) / 2, areaY + (areaMaxH - h) / 2, w, h);
      } else {
        const spacing = 10;
        const itemMaxW = (areaMaxW - spacing) / 2;
        const items = mainImgs.slice(0, 4);
        items.forEach((img, idx) => {
          const row = Math.floor(idx / 2);
          const col = idx % 2;
          const { w, h } = getImageDimensions(img, itemMaxW, areaMaxH / 2 - 5);
          const x = margin + col * (itemMaxW + spacing) + (itemMaxW - w) / 2;
          const y = areaY + row * (areaMaxH / 2 + 5) + (areaMaxH / 2 - h) / 2;
          doc.addImage(img, 'PNG', x, y, w, h);
        });
      }
    }

    const bY_base = 175; 
    const colGap = 12; 
    const colW = (pageWidth - (margin * 2) - colGap) / 2;
    
    // 核心改进：显式重置字体状态，确保字间距一致
    const resetBodyStyle = (size = 10) => {
      doc.setFontSize(size); 
      doc.setFont("helvetica", "normal"); 
      doc.setTextColor(60, 60, 60);
      // @ts-ignore
      if(doc.setCharSpace) doc.setCharSpace(0); 
    };

    const descText = cleanDescription(sanitizeText(data.description || ""));
    const features = (data.features || []).slice(0, 10);
    
    // Calculate heights to avoid footer overlap
    doc.setFontSize(10);
    const descLines = doc.splitTextToSize(descText, colW);
    const featLinesCount = features.reduce((acc, f) => acc + doc.splitTextToSize(`• ${sanitizeText(f)}`, colW).length, 0);
    
    const descHeight = descLines.length * 5;
    const featHeight = featLinesCount * 5 + (features.length * 1.5);
    const maxHeight = Math.max(descHeight, featHeight);
    
    // Footer starts around pageHeight - 18. We want to leave some buffer.
    const footerStart = pageHeight - 22;
    let bY = bY_base;
    
    // If it overlaps, move the whole block up
    if (bY + 8 + maxHeight > footerStart) {
      bY = footerStart - 8 - maxHeight;
      // If moving up too much (e.g., above 155), reduce font size instead
      if (bY < 155) {
        bY = 165; // Reset to a reasonable high position
        resetBodyStyle(9); // Smaller font
      }
    }

    doc.setFontSize(13); doc.setFont("helvetica", "bold"); doc.setTextColor(100, 100, 100);
    doc.text("Features", margin, bY); doc.text("Description", margin + colW + colGap, bY);

    resetBodyStyle(bY < 165 ? 9 : 10);
    let featY = bY + 8;
    features.forEach(f => {
      const lines = doc.splitTextToSize(`• ${sanitizeText(f)}`, colW);
      doc.text(lines, margin, featY, { align: 'left', lineHeightFactor: 1.3 });
      featY += (lines.length * (bY < 165 ? 4.5 : 5)) + 1.5; 
    });

    resetBodyStyle(bY < 165 ? 9 : 10);
    const finalDescLines = doc.splitTextToSize(descText, colW);
    doc.text(finalDescLines, margin + colW + colGap, bY + 8, { align: 'left', lineHeightFactor: 1.35 });

    // --- 后续页面处理 ---
    doc.addPage(); addHeaderFooter();
    let currentY = 35;
    const renderTable = (table?: TableData, label?: string) => {
      if (!table || !table.rows || table.rows.length === 0) return;
      if (currentY > pageHeight - 55) { doc.addPage(); addHeaderFooter(); currentY = 35; }
      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(40, 40, 40);
      doc.text(sanitizeText(table.title || label || ""), margin, currentY);
      // @ts-ignore
      doc.autoTable({
        startY: currentY + 4,
        head: [(table.headers || []).map(sanitizeText)],
        body: (table.rows || []).map(r => (r || []).map(sanitizeText)),
        theme: 'striped',
        headStyles: { fillColor: [50, 50, 50], textColor: 255, fontSize: 9, fontStyle: 'bold', halign: 'left' },
        bodyStyles: { fontSize: 8.5, textColor: 50, halign: 'left', cellPadding: 2 },
        styles: { font: 'helvetica', cellWidth: 'auto', overflow: 'linebreak' },
        margin: { left: margin, right: margin },
        didParseCell: (data: any) => {
          // Force character spacing to 0 for all cells to prevent weird gaps
          if (data.cell.styles) {
            data.cell.styles.charSpace = 0;
          }
        }
      });
      // @ts-ignore
      currentY = doc.lastAutoTable.finalY + 12;
    };
    renderTable(data.specsTable, "Electrical Parameters");
    renderTable(data.environmentalParams, "Environmental Specifications");
    renderTable(data.absoluteMaxRatings, "Absolute Maximum Ratings");

    // --- 动态分页渲染曲线图或应用场景图 ---
    const performanceImages = curves.length > 0 ? curves : scenes;
    const performanceTitle = curves.length > 0 ? "Performance Data" : "Application Scenarios";

    if (performanceImages.length > 0) {
      doc.addPage(); addHeaderFooter();
      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.text(performanceTitle, margin, 35);
      let cY = 45; 
      const cGap = 10; 
      const colWidth = (pageWidth - (margin * 2) - cGap) / 2;
      
      performanceImages.forEach((c, idx) => {
        const props = doc.getImageProperties(c);
        const aspect = props.width / props.height;
        const targetW = (idx === performanceImages.length - 1 && aspect > 1.5) ? (pageWidth - margin * 2) : colWidth;
        const targetH = targetW / aspect;

        // 如果剩余空间不足，自动换页
        if (cY + targetH > pageHeight - 30) {
          doc.addPage();
          addHeaderFooter();
          cY = 35;
        }

        const x = (targetW === colWidth) ? (margin + (idx % 2) * (colWidth + cGap)) : margin;
        doc.addImage(c, 'PNG', x, cY, targetW, targetH);
        
        // 如果是最后一列或者是宽图，则下移
        if (idx % 2 === 1 || targetW > colWidth || idx === performanceImages.length - 1) {
          cY += targetH + cGap;
        }
      });
    }

    doc.save(`${sanitizeText(productId || 'Datasheet')}_RFecho.pdf`);
  };

  return (
    <div className="max-w-7xl mx-auto p-10 font-sans text-slate-900 bg-white min-h-screen">
      <header className="mb-14 flex justify-between items-center border-b pb-8 border-slate-100">
        <div className="flex-1">
          <h1 className="text-5xl font-black text-slate-900 tracking-tighter italic uppercase flex items-center">
            RFecho Builder 
            <span className="bg-emerald-500 text-white text-[10px] font-bold not-italic px-3 py-1 rounded-full ml-4 tracking-normal uppercase">Robust v6.6</span>
          </h1>
          <p className="text-slate-400 font-semibold mt-2 tracking-wide uppercase">Industrial Synthesis Engine</p>
        </div>
        <div className="flex items-center gap-4">
            <button onClick={() => setIsBatchMode(!isBatchMode)} className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-widest border transition-colors ${isBatchMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900'}`}>
                {isBatchMode ? 'Switch to Single Mode' : 'Switch to Bulk Mode'}
            </button>
            <StatusBadge label="Assets" active={!!logo && !!bottomImg} />
        </div>
      </header>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-14">
        <div className="lg:col-span-4 space-y-8">
          <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200">
            <h2 className="text-[10px] font-black mb-6 text-slate-400 uppercase tracking-widest">Master Identity</h2>
            <AssetInput label="Logo" onChange={(e) => handlePersistentAsset(e, 'logo_png', setLogo)} active={!!logo} />
            <AssetInput label="Header Bg" onChange={(e) => handlePersistentAsset(e, 'top_png', () => {})} active={!!localStorage.getItem('top_png')} />
            <AssetInput label="Footer Bg" onChange={(e) => handlePersistentAsset(e, 'bottom_png', setBottomImg)} active={!!bottomImg} />
          </section>

          {isBatchMode ? (
            <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200">
              <h2 className="text-[10px] font-black mb-6 text-slate-400 uppercase tracking-widest">Bulk Sync</h2>
              <div className="space-y-4 mb-6">
                <label className="group block w-full py-6 px-4 bg-white border-2 border-dashed border-slate-200 rounded-3xl text-center cursor-pointer hover:border-slate-900 transition-all">
                    <span className="text-xs font-black text-slate-600 group-hover:text-slate-900 uppercase">1. Select PDF Folder</span>
                    <input type="file" {...({ webkitdirectory: "", directory: "" } as any)} multiple className="hidden" onChange={handlePdfFolderUpload} />
                </label>
                <label className="group block w-full py-6 px-4 bg-white border-2 border-dashed border-slate-200 rounded-3xl text-center cursor-pointer hover:border-amber-500 transition-all">
                    <span className="text-xs font-black text-slate-600 group-hover:text-amber-600 uppercase">2. Select Image Folder</span>
                    <input type="file" {...({ webkitdirectory: "", directory: "" } as any)} multiple className="hidden" onChange={handleImageFolderUpload} />
                </label>
              </div>
              <div className="max-h-[350px] overflow-y-auto space-y-3">
                {batchQueue.map(item => (
                  <div key={item.id} className="bg-white p-4 rounded-2xl border border-slate-100 flex justify-between items-center shadow-sm">
                    <div className="min-w-0 pr-4">
                      <p className="text-[10px] font-black truncate text-slate-800 uppercase">{item.pdf.name}</p>
                      <p className="text-[8px] font-bold text-slate-400 truncate mt-0.5">{item.relativePath}</p>
                      <p className={`text-[9px] font-bold ${item.assets.length > 0 ? 'text-emerald-500' : 'text-slate-400'}`}>
                        {item.assets.length} Assets Found
                      </p>
                    </div>
                    <div className={`text-[8px] font-black uppercase px-2 py-1 rounded shrink-0 ${item.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                      {item.status}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : (
             <section className="bg-slate-50 p-8 rounded-[2rem] border border-slate-200 shadow-sm">
              <h2 className="text-[10px] font-black mb-6 text-slate-400 uppercase tracking-widest">Single Match</h2>
              <label className="group block w-full py-5 px-6 bg-white border-2 border-dashed border-slate-200 rounded-2xl text-center cursor-pointer hover:border-slate-900 transition-all mb-4">
                  <span className="text-xs font-black text-slate-600 group-hover:text-slate-900 uppercase">+ Add Assets</span>
                  <input type="file" multiple className="hidden" onChange={(e) => {
                    const files = Array.from(e.target.files || []) as File[];
                    setSingleAssets(prev => [...prev, ...files.map((f: File = {} as File) => ({
                        id: Math.random().toString(36).substr(2, 9),
                        file: f,
                        preview: URL.createObjectURL(f),
                        role: f.name.includes('main') ? 'main' : f.name.includes('outline') ? 'outline' : 'curve'
                    } as ManualAsset))]);
                  }} />
              </label>
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {singleAssets.map(a => (
                  <div key={a.id} className="bg-white p-2 rounded-xl flex gap-3 items-center border border-slate-100">
                    <img src={a.preview} className="w-8 h-8 rounded object-cover" />
                    <select className="text-[9px] font-bold bg-slate-50 p-1 rounded" value={a.role} onChange={(e) => setSingleAssets(s => s.map(x => x.id === a.id ? {...x, role: e.target.value as any} : x))}>
                      <option value="main">Main Photo</option>
                      <option value="outline">Outline</option>
                      <option value="curve">Curve</option>
                    </select>
                  </div>
                ))}
              </div>
             </section>
          )}
        </div>

        <div className="lg:col-span-8">
          <section className="bg-slate-900 p-24 rounded-[4.5rem] shadow-2xl text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-slate-800 via-transparent to-transparent opacity-50"></div>
            <div className="relative z-10">
                <h2 className="text-6xl font-black mb-6 text-white tracking-tighter italic uppercase">
                  {isBatchMode ? 'Batch Core' : 'Reconstruct'}
                </h2>
                <p className="text-slate-400 mb-12 max-w-lg mx-auto text-sm font-medium leading-relaxed uppercase tracking-wide">
                  Memory optimized for high-volume assets. Automatic pagination handles complex data and unlimited curves.
                </p>
                {isBatchMode ? (
                  <button onClick={startBatchProcess} disabled={processing || batchQueue.length === 0} className={`inline-flex items-center justify-center px-16 py-7 rounded-3xl font-black text-xl transition-all transform hover:scale-[1.02] active:scale-95 shadow-2xl ${processing ? 'bg-slate-800 text-slate-500' : 'bg-white text-slate-900'}`}>
                    {processing ? progress : `START BATCH (${batchQueue.length})`}
                  </button>
                ) : (
                  <label className={`inline-flex items-center justify-center px-16 py-7 rounded-3xl font-black text-xl transition-all transform hover:scale-[1.02] active:scale-95 cursor-pointer shadow-2xl ${processing ? 'bg-slate-800 text-slate-500' : 'bg-white text-slate-900 hover:bg-slate-100'}`}>
                      {processing ? progress : 'ANALYZE & BUILD'}
                      <input type="file" accept=".pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) processSingle(file); }} disabled={processing} />
                  </label>
                )}
                {processing && (
                  <div className="mt-8 flex justify-center">
                    <div className="w-64 h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-500 animate-[shimmer_2s_infinite] w-full"></div>
                    </div>
                  </div>
                )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

const StatusBadge = ({ label, active }: { label: string; active: boolean }) => (
    <div className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${active ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-slate-50 text-slate-300 border-slate-100'}`}>
        {label} {active ? 'CONFIGURED' : 'PENDING'}
    </div>
);

const AssetInput = ({ label, onChange, active }: { label: string; onChange: any; active: boolean }) => (
  <div className="mb-6 last:mb-0">
    <label className="text-[9px] font-black text-slate-400 uppercase flex justify-between mb-2 tracking-widest">
        {label} {active && <span className="text-emerald-500">READY</span>}
    </label>
    <input type="file" className="block w-full text-[10px] file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-slate-900 file:text-white border border-slate-200 rounded-2xl p-2 bg-white cursor-pointer" onChange={onChange} />
  </div>
);

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

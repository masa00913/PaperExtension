console.log("offscreen.js: Script started. Attempting to initialize...");

let pdfjsLibInstance;
let initializationError = null; // 初期化エラーを保持する変数

try {
  console.log("offscreen.js: Attempting to import pdf.mjs...");
  pdfjsLibInstance = await import('./pdf.mjs');
  if (!pdfjsLibInstance || typeof pdfjsLibInstance.getDocument !== 'function') {
    const errMsg = "Failed to import pdf.mjs or getDocument function is missing.";
    console.error(`offscreen.js: ${errMsg}`, pdfjsLibInstance);
    throw new Error(errMsg);
  }
  console.log("offscreen.js: pdf.mjs imported successfully.");

  if (pdfjsLibInstance.GlobalWorkerOptions) {
    try {
      const workerSrcUrl = chrome.runtime.getURL('pdfjs/build/pdf.worker.mjs');
      pdfjsLibInstance.GlobalWorkerOptions.workerSrc = workerSrcUrl;
      console.log("offscreen.js: PDF workerSrc set to:", workerSrcUrl);
    } catch (e) {
      const errMsg = "Error setting PDF workerSrc.";
      console.error(`offscreen.js: ${errMsg}`, e);
      throw new Error(errMsg); // worker設定エラーも致命的として扱う
    }
  } else {
     const errMsg = "GlobalWorkerOptions not found on pdfjsLibInstance.";
     console.error(`offscreen.js: ${errMsg}`);
     throw new Error(errMsg);
  }

} catch (e) {
  initializationError = e.message || "Unknown initialization error.";
  console.error("offscreen.js: CRITICAL error during initialization phase:", e);
  // 初期化に失敗した場合、この Offscreen Document は機能しない
}

// 初期化が成功した場合のみリスナーを設定
if (!initializationError && pdfjsLibInstance) {
  chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    console.log("offscreen.js: Message received:", request);

    if (initializationError) { // ダブルチェック
        console.error("offscreen.js: Listener invoked but initialization failed earlier. Error:", initializationError);
        sendResponse({ text: null, error: `Offscreen document initialization failed: ${initializationError}` });
        return true;
    }

    if (request.target !== 'offscreen' || request.action !== 'extractPdfText') {
      console.log("offscreen.js: Message not for this offscreen document or action.");
      return false;
    }

    const pdfUrl = request.pdfUrl;
    if (!pdfUrl) {
      console.error('offscreen.js: PDF URL is missing in request.');
      sendResponse({ text: null, error: 'PDF URL is missing.' });
      return true;
    }

    console.log(`offscreen.js: Attempting to process PDF URL: ${pdfUrl}`);
    try {
      const loadingTask = pdfjsLibInstance.getDocument({ url: pdfUrl });
      const pdf = await loadingTask.promise;
      console.log(`offscreen.js: PDF loaded. Pages: ${pdf.numPages}.`);

      if (pdf.numPages === 0) {
        console.warn(`offscreen.js: PDF has 0 pages. URL: ${pdfUrl}`);
        sendResponse({ text: null, error: `PDF has 0 pages: ${pdfUrl}` });
        return true;
      }

      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        try {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + (textContent.items.length > 0 ? '\n\n' : '');
        } catch (pageError) {
          console.error(`offscreen.js: Error processing page ${i} for PDF ${pdfUrl}:`, pageError);
          fullText += `[Error processing page ${i}]\n\n`;
        }
      }

      fullText = fullText.trim();
      if (fullText === "" || fullText.startsWith("[Error processing page")) {
        console.warn(`offscreen.js: PDF text extraction resulted in empty or error-only text. URL: ${pdfUrl}. Extracted: "${fullText.substring(0,100)}"`);
        sendResponse({ text: null, error: `No valid text content found or errors during page processing in PDF: ${pdfUrl}` });
      } else {
        console.log(`offscreen.js: PDF text extraction successful. Length: ${fullText.length}. Preview: ${fullText.substring(0,100)}`);
        sendResponse({ text: fullText, error: null });
      }
    } catch (error) {
      console.error(`offscreen.js: Error in getDocument or main PDF processing for URL ${pdfUrl}:`, error);
      let errorMessage = `Failed to load or process PDF. URL: ${pdfUrl}.`;
      if (error && error.message) {
        errorMessage += ` Details: ${error.message}`;
      } else if (typeof error === 'string') {
        errorMessage += ` Details: ${error}`;
      }
      if (error && error.name) {
         errorMessage += ` (Error Name: ${error.name})`;
      }
      try {
        errorMessage += ` Raw Error: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
      } catch (e) { /* ignore stringify error */ }

      sendResponse({ text: null, error: errorMessage });
    }
    return true;
  });
  console.log("offscreen.js: Message listener added successfully.");
} else {
  console.error("offscreen.js: Initialization failed. Message listener NOT added. Error:", initializationError);
  // background.js に初期化失敗を通知する手段があれば理想的だが、
  // この時点で sendResponse はできないため、background.js はタイムアウトする。
}
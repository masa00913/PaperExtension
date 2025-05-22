// このスクリプトは閲覧ページ内で実行され、情報を抽出します。
function getPageDetails() {
    let details = {
      title: document.title,
      url: window.location.href,
      doi: null,
      authors: [],
      year: null,
      journal: null,
      abstract: '',
      pageText: '', // PDFの場合は background で抽出
      isPdf: window.location.href.toLowerCase().endsWith('.pdf')
    };
  
    if (details.isPdf) {
        details.type = 'pdf_document';
        // PDFの場合、メタデータの多くは直接取得が困難。
        // title は document.title から取得できる場合がある。
        // name は title や URL から生成することを試みる。
        const pdfFileName = details.url.substring(details.url.lastIndexOf('/') + 1).replace(/\.pdf$/i, '');
        details.name = details.title || pdfFileName || "PDF Document";

        // PDFのファイル名やタイトルから年を推測する試み（簡易的）
        const yearMatchInTitle = (details.title.match(/\b(19|20)\d{2}\b/) || [])[0];
        const yearMatchInFileName = (pdfFileName.match(/\b(19|20)\d{2}\b/) || [])[0];
        details.year = yearMatchInTitle || yearMatchInFileName || null;

    } else {
        // HTMLページの場合の既存のメタデータ抽出ロジック
        const doiMeta = document.querySelector('meta[name="citation_doi"]') ||
                        document.querySelector('meta[name="DOI"]');
        if (doiMeta) details.doi = doiMeta.content;
  
        document.querySelectorAll('meta[name="citation_author"]').forEach(meta => {
          details.authors.push(meta.content);
        });
  
        const yearMeta = document.querySelector('meta[name="citation_publication_date"]') ||
                         document.querySelector('meta[name="citation_year"]');
        if (yearMeta) {
          const yearMatch = yearMeta.content.match(/\b\d{4}\b/);
          if (yearMatch) details.year = yearMatch[0];
        }
  
        const journalMeta = document.querySelector('meta[name="citation_journal_title"]');
        if (journalMeta) details.journal = journalMeta.content;
  
        const abstractElement = document.querySelector('.abstract') || document.querySelector('[class*="Abstract" i]') || document.getElementById('abstract') || document.querySelector('[id*="abstract" i]');
        if (abstractElement) details.abstract = abstractElement.innerText.trim().substring(0, 8000); // 少し長めに取得
  
        console.log("ページの文字数" + document.body.innerText.length)
        details.pageText = document.body.innerText;
  
        if (details.journal) {
          details.type = "article";
        } else {
          details.type = "misc";
        }
    }
  
    // Name (筆頭著者 年 または タイトルから生成)
    if (!details.isPdf && details.authors.length > 0 && details.year) {
      const firstAuthorLastName = details.authors[0].split(',')[0].trim().split(' ').pop();
      details.name = `${firstAuthorLastName} ${details.year}`;
      details.firstAuthor = details.authors[0];
    } else if (details.year && !details.name) { // nameがまだ設定されていなければ
      details.name = `Unknown ${details.year}`;
    } else if (!details.name) { // それでもnameがなければ
        details.name = details.title ? details.title.substring(0, 50) : "Unknown Document";
    }
    // PDFの場合のfirstAuthorは取得できないので設定しない
    if (details.isPdf) {
        details.firstAuthor = null;
    } else if (details.authors.length > 0) {
        details.firstAuthor = details.authors[0];
    }


    // Citekey
    if (details.firstAuthor && details.year && details.title) {
        const firstAuthorLastName = details.firstAuthor.split(',')[0].trim().split(' ').pop() || "NoAuthor";
        const firstWordTitle = details.title.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || "NoTitle";
        details.citekey = `${firstAuthorLastName}${details.year}${firstWordTitle}`;
    } else if (details.name && details.name !== "Unknown Document" && details.name !== "PDF Document" && details.year) {
        details.citekey = `${details.name.replace(/[\s,.]/g, '').substring(0,15)}${details.year}`;
    } else {
        details.citekey = `Citekey${Date.now()}`;
    }
  
    return details;
  }
  
  // バックグラウンドスクリプトからのリクエストに応じてページ情報を返す
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPageDetails") {
      const details = getPageDetails();
      sendResponse(details);
    }
    return true; // 非同期でsendResponseを呼ぶ場合
  });
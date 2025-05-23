// このスクリプトは閲覧ページ内で実行され、情報を抽出します。
async function getPageDetails() {
    let details = {
      title: document.title,
      url: window.location.href,
      doi: null,
      authors: [],
      year: null,
      journal: null,
      pageText: '', 
      publisher: null,
      volume: null,
      pages: null,
      issue: null,
      message: '',
    };

    // 既存のDOI抽出ロジック
    // arXivのDOIリンクからDOIを抽出する試み
    const arxivDoiLink = document.getElementById('arxiv-doi-link');
    if (arxivDoiLink && arxivDoiLink.href) {
        const doiMatch = arxivDoiLink.href.match(/doi\.org\/(.*)/);
        if (doiMatch && doiMatch[1]) {
            details.doi = doiMatch[1];
        }
    }

    // ACMのDOIメタタグからDOIを抽出する試み
    if (!details.doi) {
        const acmDoiMeta = document.querySelector('meta[name="dc.Identifier"][scheme="doi"]');
        if (acmDoiMeta && acmDoiMeta.content) {
            details.doi = acmDoiMeta.content;
        }
    }

    // arXivやACMのDOIが見つからない場合、通常のメタタグを探す
    if (!details.doi) {
        const doiMeta = document.querySelector('meta[name="citation_doi"]') ||
                        document.querySelector('meta[name="DOI"]');
        if (doiMeta) details.doi = doiMeta.content;
    }
    
    // HTMLページの場合
    // まず本文を取得
    details.pageText = document.body.innerText.replace(/\n/g, ''); // ページのテキストを取得し、改行を削除


    if (details.doi) {
        try {
            const response = await fetch(`https://api.crossref.org/works/${details.doi}`);
            if (response.ok) {
                const data = await response.json();
                const message = data.message;
                if (message.title && message.title.length > 0) {
                    details.title = message.title[0];
                }
                if (message.author && message.author.length > 0) {
                    details.authors = message.author.map(auth => `${auth.given ? auth.given + ' ' : ''}${auth.family || ''}`.trim() || auth.name || '');
                }
                if (message.created && message.created['date-parts'] && message.created['date-parts'][0]) {
                    details.year = message.created['date-parts'][0][0].toString();
                }
                if (message['container-title'] && message['container-title'].length > 0) {
                    details.journal = message['container-title'][0];
                    // ジャーナル名から括弧とその中身を削除
                    if (details.journal) {
                      details.journal = details.journal.replace(/\s*\(.*\)\s*$/, '').trim();
                    }
                }
                if (message.publisher) {
                    details.publisher = message.publisher;
                }
                if (message.volume) {
                    details.volume = message.volume;
                }
                if (message.issue) {
                    details.issue = message.issue;
                }
                if (message.page) {
                    details.pages = message.page;
                }
                if(message.journal){
                    details.journal = message.journal;
                }
                if(message.type){
                    details.type = message.type;
                }
            }
        } catch (error) {
            console.error("Error fetching data from CrossRef:", error);
            // CrossRefからの取得に失敗した場合、フォールバックとして一部情報をmetaタグから取得
        }
    }

    // Name (筆頭著者 年 または タイトルから生成)
    if (details.authors.length > 0 && details.year) {
      const firstAuthorName = details.authors[0];
      const firstAuthorLastName = firstAuthorName.includes(',') ? firstAuthorName.split(',')[0].trim().split(' ').pop() : firstAuthorName.split(' ').pop();
      details.name = `${firstAuthorLastName} ${details.year}`;
      details.firstAuthor = firstAuthorName;
    } else if (details.title && details.year) {
        details.name = `${details.title.substring(0,20)} ${details.year}`; // タイトルと年で名前を生成
    } else if (details.title) {
        details.name = details.title;
    } else if (details.year && !details.name) { // nameがまだ設定されていなければ
      details.name = `Unknown ${details.year}`;
    } else if (!details.name) {
      details.name = "Unknown Document";
    }
    // 著者名の整形
    if(details.authors.length > 0) {
        details.firstAuthor = details.authors[0];
    }


    // Citekey
    if (details.firstAuthor && details.year && details.title) {
        const firstAuthorName = details.firstAuthor;
        const firstAuthorLastName = firstAuthorName.includes(',') ? firstAuthorName.split(',')[0].trim().split(' ').pop() : firstAuthorName.split(' ').pop() || "NoAuthor";
        const firstWordTitle = details.title.split(' ')[0].replace(/[^a-zA-Z0-9]/g, '') || "NoTitle";
        details.citekey = `${firstAuthorLastName}${details.year}${firstWordTitle}`;
    } else if (details.name && details.name !== "Unknown Document" && details.year) {
        details.citekey = `${details.name.replace(/[\s,.]/g, '').substring(0,15)}${details.year}`;
    } else {
        details.citekey = `Citekey${Date.now()}`;
    }

    return details;
  }
  
  // バックグラウンドスクリプトからのリクエストに応じてページ情報を返す
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getPageDetails") {
      getPageDetails().then(details => {
        sendResponse(details);
      }).catch(error => {
        console.error("Error in content_script getPageDetails:", error);
        sendResponse({ 
          error: true, 
          message: "Failed to retrieve page details from content_script: " + error.message 
        });
      });
      return true; // 重要: sendResponse が非同期に呼び出されることを示します。
    }
    // 他のメッセージタイプを処理する場合、それらも非同期であれば true を返すようにしてください。
  });
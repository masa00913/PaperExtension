// 設定値のプレースホルダー (実際にはchrome.storageから取得)
let NOTION_API_KEY = '';
let NOTION_DATABASE_ID = '';
let GEMINI_API_KEY = '';

// 設定を読み込む関数
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['notionApiKey', 'notionDbId', 'geminiApiKey'], (result) => {
      NOTION_API_KEY = result.notionApiKey || '';
      NOTION_DATABASE_ID = result.notionDbId || '';
      GEMINI_API_KEY = result.geminiApiKey || '';
      resolve();
    });
  });
}

// Gemini APIで要約を生成
async function getSummaryFromGemini(textToSummarize) {
  if (!GEMINI_API_KEY) throw new Error("Gemini APIキーが設定されていません。");
  if (!textToSummarize || textToSummarize.trim() === "") {
    return "要約対象のテキストがありません。";
  }

  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${GEMINI_API_KEY}`;
  // Gemini 1.5 Flash が利用できない場合は gemini-pro などを試してください
  // const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`;


  const requestBody = {
    contents: [{
      parts: [{
        text: `# 命令書:
                ライティングの専門家として，論文要約のサポートしてください．
                以下の制約条件と入力文をもとに最高の要約を出力してください。

                # 制約条件:
                - この論文はどのような論文か記述してください。特に、研究の背景部分と目的部分を含めてください。
                - 内容をわかりやすく伝えるために最善を尽くしてください。
                - 重要なキーワードを取り残さない。
                - 以下のトピックを抑えてください。このとき、見出しを作成してください。
                    - 背景
                    - 目的
                    - 先行研究との比較
                    - 技術や方法のポイント
                    - 実験方法
                    - 結果
                    - 議論
                - 文の言い回しは学術論文の書き方を参考にしてください。
                - 句読点について，「。」を「．」「、」を「，」に変更してください．
                - 段落ごとに改行をして出力してください．
                - 大学院生のレベルの文章にしてください．
                - 語尾は敬語ではなく，「である」のように学術論文で用いられているフォーマットにしてください．
                - このタスクで最高の結果を出すために追加の情報が必要な場合は質問をしてください。

                # 入力文：
                ${textToSummarize}

                # 出力文：
                日本語で出力してください。`
      }]
    }],
    // 安全設定 (必要に応じて調整)
    // safetySettings: [
    //   { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    //   { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
    // ],
    generationConfig: {
      // temperature: 0.7,
      // topK: 1,
      // topP: 1,
      maxOutputTokens: 65536, // 必要に応じて調整
    }
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API Error:', errorData);
      throw new Error(`Gemini APIエラー: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    // console.log("Gemini Raw Response:", JSON.stringify(data, null, 2)); // デバッグ用

    if (data.candidates && data.candidates.length > 0 &&
        data.candidates[0].content && data.candidates[0].content.parts &&
        data.candidates[0].content.parts.length > 0) {
      return data.candidates[0].content.parts[0].text.trim();
    } else if (data.promptFeedback && data.promptFeedback.blockReason) {
        throw new Error(`Gemini APIによりブロックされました: ${data.promptFeedback.blockReason} - ${data.promptFeedback.safetyRatings?.map(r => r.category + ':'+r.probability).join(', ')}`);
    }
     else {
      console.warn("Gemini APIからの要約取得に失敗しました。レスポンス形式が予期したものと異なります。", data);
      return "要約の取得に失敗しました。";
    }
  } catch (error) {
    console.error("Gemini APIリクエスト中にエラー:", error);
    throw error;
  }
}

// Notion APIのリッチテキスト要素の最大文字数
const RICH_TEXT_LIMIT = 2000;

// テキストを2000文字以下のチャンクに分割するヘルパー関数
function splitTextIntoChunks(text, limit = RICH_TEXT_LIMIT) {
  const chunks = [];
  if (!text) return chunks;
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.substring(i, i + limit));
  }
  return chunks;
}

async function saveToNotion(pageDetails, summary) {
  if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
    console.error("Notion APIキーまたはデータベースIDが未設定です。");
    throw new Error("Notion APIキーまたはデータベースIDが設定されていません。");
  }

  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_API_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };

  const pageTitle = pageDetails.name || pageDetails.title || "無題のページ";
  const pageUrl = pageDetails.url;
  const authors = pageDetails.authors.map(author => ({ name: author })); // Notionのmulti_select形式
  const journal = pageDetails.journal ? { name: pageDetails.journal } : null; // select形式
  const year = pageDetails.year ? parseInt(pageDetails.year, 10) : null;
  const doi = pageDetails.doi;
  const citekey = pageDetails.citekey;
  const firstAuthor = pageDetails.firstAuthor ? { name: pageDetails.firstAuthor } : null;
  const type = pageDetails.type ? { name: pageDetails.type } : { name: "misc" };

  // 本文ブロックの構築
  const children = [];

  // 1. 要約
  if (summary && summary.trim() !== "") {
    children.push({
      object: 'block',
      type: 'heading_2',
      heading_2: {
        rich_text: [{ type: 'text', text: { content: 'AIによる要約' } }]
      }
    });
    // 要約が2000文字を超える場合も分割
    const summaryChunks = splitTextIntoChunks(summary.trim());
    summaryChunks.forEach(chunk => {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      });
    });
  }

  // 3. 論文情報 (オプション)
  children.push({
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: '論文情報' } }]
    }
  });
  let detailsText = `URL: ${pageUrl}\n`;
  if (doi) detailsText += `DOI: ${doi}\n`;
  if (pageDetails.authors.length > 0) detailsText += `Authors: ${pageDetails.authors.join(', ')}\n`;
  if (journal) detailsText += `Journal: ${pageDetails.journal}\n`;
  if (year) detailsText += `Year: ${year}\n`;

  const detailChunks = splitTextIntoChunks(detailsText.trim());
    detailChunks.forEach(chunk => {
      children.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: chunk } }]
        }
      });
    });


  const notionPageData = {
    parent: { database_id: NOTION_DATABASE_ID },
    properties: {
       // プライマリカラム
      'Name': { title: [{ text: { content: pageDetails.name || '' } }] },
      'Title': { rich_text: [{ text: { content: pageDetails.title || '' } }] },
      'DOI': { rich_text: [{ text: { content: pageDetails.doi || '' } }] },
      'URL': { url: pageDetails.url || null },
      'First': (() => {
        if (!pageDetails.firstAuthor) return null;
        let nameToFormat = pageDetails.firstAuthor;
        let firstAuthorSelectName;
        const nameParts = nameToFormat.split(',').map(part => part.trim());
        if (nameParts.length === 2 && nameParts[0] && nameParts[1]) {
        // Format "LastName, FirstName" to "FirstName LastName"
        firstAuthorSelectName = `${nameParts[1]} ${nameParts[0]}`;
        } else {
        // Otherwise, use the name as is (trimmed)
        firstAuthorSelectName = nameToFormat.trim();
        }
        return { select: { name: firstAuthorSelectName.substring(0, 99) } };
      })(),
      'Authors': pageDetails.authors && pageDetails.authors.length > 0 ? {
        multi_select: pageDetails.authors.map(author => {
        let transformedName;
        const nameParts = author.split(',').map(part => part.trim());
        if (nameParts.length === 2 && nameParts[0] && nameParts[1]) {
            // Format "LastName, FirstName" to "FirstName LastName"
            transformedName = `${nameParts[1]} ${nameParts[0]}`;
        } else {
            // Otherwise, use the name as is (trimmed)
            transformedName = author.trim();
        }
        return { name: transformedName.substring(0, 99) };
        })
      } : null,
      'Year': pageDetails.year ? { number: parseInt(pageDetails.year, 10) }: '',
      'Journal':  { select: { name: pageDetails.journal ?pageDetails.journal.split(',')[0].trim().substring(0, 99) : null } },
      'Type':  { select: { name: pageDetails.type ? pageDetails.type.substring(0, 99) : null} } ,
      
      'Citekey': { rich_text: [{ text: { content: pageDetails.citekey || '' } }] },
      'Edition': { rich_text: [{ text: { content: '' } }] }, // 仮に空で設定
      'Volume': { rich_text: [{ text: { content: pageDetails.volume?pageDetails.volume:"" } }] }, // 仮に空で設定
      'Pages': { rich_text: [{ text: { content: pageDetails.pages?pageDetails.pages:"" } }] },  // 仮に空で設定
      'info' : {checkbox: true}, // 追加の情報を保存するためのプロパティ (例: checkbox型)
      'created_at': { date: { start: new Date().toISOString() } }, // 作成日時 (現在の日時)
      'Publisher' :  {select: {name: pageDetails.publisher ? pageDetails.publisher.substring(0, 99): ""}},

    },
    children: children
  };

  // Journal プロパティが存在する場合のみ追加
  if (journal && notionPageData.properties) {
    notionPageData.properties['Journal'] = { select: journal };
  }
  // Abstract プロパティが存在する場合のみ追加 (DBにこの名前のプロパティがある場合)
  // if (pageDetails.abstract && notionPageData.properties) {
  //   notionPageData.properties['Abstract'] = { rich_text: [{ text: { content: pageDetails.abstract.substring(0, RICH_TEXT_LIMIT) } }] };
  // }


  console.log("Sending to Notion:", JSON.stringify(notionPageData, null, 2));

  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders,
    body: JSON.stringify(notionPageData)
  });

  if (!response.ok) {
    const errorData = await response.json();
    console.error("Notion API response error:", errorData);
    throw new Error(`Notion APIエラー (${response.status}): ${errorData.message}`);
  }

  console.log('ページがNotionに正常に保存されました。');
  return await response.json();
}

// PDF処理関連の関数と定数を削除
// const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html'; 
// let creatingOffscreenPromise = null;

// async function ensureOffscreenDocument() { ... } // 削除
// async function extractPdfTextViaOffscreen(pdfUrl) { ... } // 削除

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "savePageToNotion") {
    (async () => {
      try {
        await loadSettings();
        if (!NOTION_API_KEY || !NOTION_DATABASE_ID || !GEMINI_API_KEY) {
            throw new Error("APIキーまたはデータベースIDが設定されていません。ポップアップで設定してください。");
        }

        let pageDetails = await chrome.tabs.sendMessage(request.tabId, { action: "getPageDetails" });
        if (!pageDetails || pageDetails.error) { // content_scriptからのエラーもチェック
            throw new Error(pageDetails?.message || "ページ情報の取得に失敗しました。");
        }
        console.log("Background: Received pageDetails:", JSON.stringify(pageDetails, null, 2));

        // PDF関連の処理を削除
        let textToSummarize = pageDetails.pageText; // pageTextをそのまま使用

        // PDF固有の要約メッセージロジックを削除・修正
        let summary = "要約はスキップされました（対象テキストなし）。";
        if (textToSummarize && textToSummarize.trim().length > 10) {
            summary = await getSummaryFromGemini(textToSummarize);
        } else if (!textToSummarize || textToSummarize.trim().length <=10) {
            // PDF以外のケースも考慮した汎用的なメッセージに変更
            summary = "ページからテキストを抽出できませんでした、またはテキストが短すぎたため要約はスキップされました。";
        }
        console.log("Background: Summary generated:", summary);
        // Notionに保存
        await saveToNotion(pageDetails, summary);
        sendResponse({ success: true });
      } catch (error) {
        console.error("Background: Error in savePageToNotion flow:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
  // 他のメッセージリスナーがある場合はそのまま残す
  return true; // 非同期処理のためtrueを返す
});
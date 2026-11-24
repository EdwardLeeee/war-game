# 公開上架 App Store 前要做的事

TestFlight 只給使用者自己裝，這些都不擋 TestFlight。使用者決定要公開上架時（D-163：玩過再決定），
ceo 先逐項問使用者，再派工。

- **對局紀錄的開關和隱私說明**（D-056 之後的決策紀錄：上架前隱私說明要寫明會上傳對局紀錄，並讓玩家可以關掉）。
  app 裡要有：
  - 關掉上傳的開關；
  - 一頁隱私說明，App Store Connect 後台也要填它的網址。
  經 ceo 派 client（開關、上傳）和 ui（畫面）。改完後，`ios/App/App/PrivacyInfo.xcprivacy` 和 App Store
  Connect 的 App Privacy 答案要一致（現在宣告：遊戲內容用於分析、當機資料用於 app 功能，都不連到身分、不追蹤）。
- **App Store 頁面的「銷售者」會顯示帳號持有人的本名**：個人開發者帳號就是這樣。ceo 在問要不要公開上架時，
  先告訴使用者這一點（ceo 2026-11-24）。本名不寫進 repo、log 或任何訊息；發布 workflow 已經把簽章憑證裡的
  名字從 log 遮掉（`ci/signing.sh`），簽章的 log 也不放進 artifact。
- **商店資料**：副標題、關鍵字（預定「即時戰略、RTS、策略、離線」）、描述、截圖、年齡分級、價格（免費）
  與地區、審核說明。照 app-store-launch 的第 6、7 階段做。
- **正式圖示和啟動畫面**：現在用的是網頁的暫時圖示和底色；由 ui 出稿給使用者看。
- **遊戲裡的「關於／授權」入口**（D-163）：和 app 的設定一起由 ui 出稿。授權文字已經放在 app 裡（`licenses/`）。
- **憑證到期**：Apple Distribution 憑證和描述檔一年到期，到期日在 `scripts/ios-signing.sh` 的輸出和發布 run 的
  Summary 裡。到期前重做 `docs/apple-setup.md` 的第 2、3、7 步。

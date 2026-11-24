# 「裂土稱王」iPhone app 上 TestFlight 前的蘋果帳號設定（第 3 階段）

做一次，大約 30 分鐘。你要做的：在蘋果的網站上按幾個按鈕、下載 3 個檔案、抄 3 個代碼，
中間在 Claude Code 裡跑 3 行指令（開頭是 `!`，在這台電腦上執行）。
金鑰都只存在這台電腦的 `~/.config/war-game/ios/`（只有你的帳號讀得到），經由指令直接交給 GitHub，
任何 Claude 都不會看到內容。

**開始前**

- 先在 war-game repo 的根目錄（main 是最新的）開 Claude Code。
- 用你加入 Apple Developer Program 的 Apple ID 登入（會要求兩步驟驗證）。
- 網頁上方如果出現「需要同意新版協議」的橫幅，先按進去同意，不然後面的按鈕會是灰的、上傳也會失敗。
- 下載的檔案都留在瀏覽器預設的 `~/Downloads`，不用搬。
- 標著 ⚠️ 的步驟，mobile 沒辦法先對照蘋果網站的畫面：**如果畫面和這裡寫的不一樣，停下來截圖給 ceo**，不要自己猜。
- 名稱（你 2026-11-24 定的）：App Store 上是「裂土稱王：RTS 即時戰略」，英文「Divide & Crown: RTS」；
  手機桌面上的圖示名稱是「裂土稱王」（英文的 iPhone 是「Divide & Crown」，已經寫在 app 裡）。

## 0. 產生憑證請求檔

在 Claude Code 輸入：

```
! bash mobile/scripts/ios-signing.sh csr
```

它會在 `~/.config/war-game/ios/` 產生私鑰（秘密，不會離開這台電腦），並把「憑證請求檔」
`war-game.certSigningRequest` 放進 `~/Downloads`（這個檔不是秘密）。

## 1. 登記 app 的身分（App ID）

告訴蘋果「com.edwardleeee.wargame 這個 app 是我的」。

1. 開 https://developer.apple.com/account/resources/identifiers/list
2. 按「Identifiers」標題旁的藍色 **＋**。
3. 選 **App IDs** → **Continue** → 選 **App** → **Continue**。
4. ⚠️ **Description** 填 `Divide and Crown`（用 and，不用 `&`：這一欄可能不收特殊符號）；**Bundle ID** 選 **Explicit**，填 `com.edwardleeee.wargame`
   （一字不差；第一次上傳後就永遠不能改）。
5. 下面一長串 Capabilities 都不用勾 → **Continue** → **Register**。

## 2. 建立發布憑證（Apple Distribution）

證明「這個 app 是你簽出來的」。

1. 開 https://developer.apple.com/account/resources/certificates/list
2. 按「Certificates」標題旁的 **＋**。
3. 選 **Apple Distribution** → **Continue**。
4. 按 **Choose File**，選 `~/Downloads/war-game.certSigningRequest` → **Continue**。
5. 按 **Download**。檔案（通常叫 `distribution.cer`）會存到 `~/Downloads`。
6. 在 Claude Code 輸入：

   ```
   ! bash mobile/scripts/ios-signing.sh p12 ~/Downloads/distribution.cer
   ```

   它會把憑證和私鑰合成簽章用的 `.p12`（密碼自動產生、存成檔案），並印出憑證的**到期日**（一年後）。
   把到期日告訴 ceo：到期前要重做第 2、3 步，不然就不能再上傳新版本。

## 3. 建立描述檔（Provisioning Profile）

把「app 身分」和「發布憑證」綁在一起。

1. 開 https://developer.apple.com/account/resources/profiles/list
2. 按「Profiles」標題旁的 **＋**。
3. 在 **Distribution** 底下選 **App Store Connect** → **Continue**。
4. **App ID** 選 `Divide and Crown (com.edwardleeee.wargame)` → **Continue**。
5. 勾第 2 步建立的 Apple Distribution 憑證 → **Continue**。
6. **Provisioning Profile Name** 一定要填 `war-game App Store`（大小寫、空白都要一樣，程式用這個名字找它）
   → **Generate**。
7. 按 **Download**。檔案（類似 `war-game_App_Store.mobileprovision`）會存到 `~/Downloads`。

## 4. 建立 App Store Connect API 金鑰

讓 GitHub 能替你把 app 上傳到 TestFlight，不用每次輸入 Apple ID 密碼。

1. 開 https://appstoreconnect.apple.com/access/integrations/api
   （或 App Store Connect 首頁 → **Users and Access** → 上方 **Integrations** 分頁 →
   左邊 **App Store Connect API** → **Team Keys**）。
2. 第一次會看到 **Request Access**：按下去、同意條款。通常會立刻開通。
3. 按 **Generate API Key**（或表格旁的 **＋**）。
4. **Name** 填 `GitHub Actions`；**Access** 選 **App Manager** → **Generate**。
5. 在新出現的那一列按 **Download API Key** → **Download**。檔案叫 `AuthKey_XXXXXXXXXX.p8`，存到 `~/Downloads`。
   **這個檔只能下載一次**：第 7 步之後要備份到你的密碼管理器。
6. 抄下兩個代碼：那一列的 **Key ID**（10 碼），以及表格上方的 **Issuer ID**（一長串，含 `-`）。

## 5. 在 App Store Connect 建立 app

這一步才會知道名稱有沒有被別人用掉。

1. 開 https://appstoreconnect.apple.com/apps → 左上角 **＋** → **New App**。
2. **Platforms** 勾 **iOS**。
3. **Name** 填 `裂土稱王：RTS 即時戰略`（中間是全形冒號「：」，RTS 前後各一個半形空格）。
   如果出現「名稱已被使用」，**停下來告訴 ceo**，不要自己換名字。
4. **Primary Language** 選 **Chinese (Traditional)**（繁體中文）。
5. **Bundle ID** 選 `Divide and Crown - com.edwardleeee.wargame`。
6. **SKU** 填 `war-game-ios`（只給自己看的代號）。
7. **User Access** 選 **Full Access** → **Create**。
8. ⚠️ 加英文名稱：在剛建好的 app 裡，左邊 **App Information**（App 資訊）→ 右上角語言選單（現在是
   「Chinese (Traditional)」）→ 選 **English (U.S.)** → **Name** 填 `Divide & Crown: RTS` → 右上角 **Save**。
   這裡一樣：名稱被占用就停下來告訴 ceo。
   （副標題、關鍵字等公開上架時再填，現在留空。）

## 6. 抄下 Team ID

1. 開 https://developer.apple.com/account
2. 往下捲到 **Membership details**，抄下 **Team ID**（10 碼英數字）。

## 7. 存進 GitHub

在 Claude Code 輸入（把三個代碼換成你抄的；檔名照 `~/Downloads` 裡實際的）：

```
! bash mobile/scripts/ios-signing.sh secrets ~/Downloads/war-game_App_Store.mobileprovision ~/Downloads/AuthKey_XXXXXXXXXX.p8 <Key ID> <Issuer ID> <Team ID>
```

它會：

- 檢查描述檔的名稱、App ID、Team ID 對不對（不對就停下、什麼都不存）；
- 把描述檔和 `.p8` 從 `~/Downloads` 搬到 `~/.config/war-game/ios/`，`~/Downloads` 不會留下 `.p8`；
- 把 `.p12`、它的密碼、描述檔、`.p8`、Key ID、Issuer ID 存成 GitHub secrets，Team ID 存成 GitHub variable；
- 印出描述檔的到期日和要備份的檔案。

**請你備份到密碼管理器（或離線備份）**：`~/.config/war-game/ios/` 裡的 `AuthKey_XXXXXXXXXX.p8`、
`distribution.p12`、`p12-password.txt`。GitHub secrets 存進去就讀不回來，這幾個檔是唯一的正本。
備份好跟 ceo 說一聲。

## 8. TestFlight

1. App Store Connect → 你的 app → 上方 **TestFlight** → 左邊 **Internal Testing** 旁的 **＋** →
   群組名稱填 `自己` → **Create**。
2. 在群組裡按 **Testers** 旁的 **＋**，勾你自己（帳號持有人已經是 App Store Connect 的使用者）→ **Add**。
3. 在 iPhone 上從 App Store 安裝 **TestFlight**。

接著 ceo 會請 mobile 跑一次發布：第一個建置處理完（通常 10–30 分鐘）會自動出現在群組裡，
你的 iPhone 會收到 TestFlight 的通知或 email。

## 9. 在你的 iPhone 14 Pro Max 上試

在 TestFlight 裡按 **安裝**，然後：

1. 開 app，開一局，玩到第 2 分鐘以後。
2. 回主畫面，從多工畫面把 app 往上滑掉（強制關閉），再打開：要看到「繼續上一局（第 N 分）」，按下去能接著玩。
3. 打開飛航模式，再做一次 1、2。
4. 有任何不對（畫面、按鈕、卡頓、閃退）截圖告訴 ceo。注意：app 和 Safari 的存檔是分開的，
   第一次打開 app 不會有網頁版的存檔。

# 第三方素材與授權

遊戲本身保留所有權利（沒有開源授權）。下面是美術製作用到的外部素材。

每一項使用前都讀過官方授權原文，日期記在表裡。原始檔不進這個 repo：CI 照網址下載，核對 sha256。

## 用在出貨圖裡的素材

| 素材 | 用在哪 | 授權 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Poly Haven 貼圖 18 種（清單和每個檔的網址、sha256 在 `design/r7/common/textures.py`、`textures_sha.json`）：rough_linen、hessian_230、brown_leather、fabric_leather_02、metal_plate、rusty_metal_02、fine_grained_wood、medieval_wood、old_planks_02、castle_brick_01、clay_plaster、thatch_roof_angled、clay_roof_tiles_02、leafy_grass、aerial_grass_rock、stony_dirt_path、gravel_ground_01、brown_mud_rocks_01 | R7 寫實比較（D-092）：兵、建築、地面的材質，算進圖裡 | CC0 1.0（可商用，不用標示出處） | https://polyhaven.com/license | 2026-10-20 |
| MPFB 2.0.18（MakeHuman 的 Blender 外掛）的底模、變形、權重 | R7 版本 2：寫實人體 | 素材 CC0 1.0；官方寫明產出物不受任何限制 | https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md | 2026-10-20 |
| 寫實馬：Lyndon Daniels〈Realtime Rancher's 3D Model Pack〉的馬（網格、2k 顏色／法線／AO 貼圖、鬃毛和尾巴）；ChadM 加上骨架和權重的版本〈rigged horse〉。檔案 `horse.zip`（sha256 469704f5…0043d27）、`riggedHorse.blend`（sha256 9cca670b…7037f4a） | R8 騎兵的馬（`design/r8/blender/horse_r8.py`） | CC0 1.0（兩個頁面都標 CC0；rigged 版寫明「授權和 Lyndon 的原版相同」） | https://opengameart.org/content/realtime-ranchers-3d-model-pack 、 https://opengameart.org/content/rigged-horse | 2026-10-21 |

MPFB 的程式本身是 GPLv3。我們只在 Blender 裡把它當工具用，沒有散布它的程式，遊戲裡也不含它的程式。下載網址：https://extensions.blender.org/add-ons/mpfb/，檔案 sha256 c075b3e9…2a2dad，和官方網址上的一致。

## 只當參考、放在核准稿上的圖

R8 東陸槍兵、弓手的核准稿（`design/r8/out/R8-03-*`、`R8-05-*`）旁邊放了幾張裁切過的參考圖，給使用者對照。美術是照著重新做 3D，圖本身不放進遊戲。原檔不進 repo（ceo 的考據資料夾 `research/east-reference/`，授權清單 `LICENSES.md`）。CC BY-SA 的圖（07、08、09、13、14、15）只拿來看，不放進 repo，也不放進核准稿。

| 圖 | 來源頁 | 授權 | 作者 | 讀授權的日期 |
|---|---|---|---|---|
| 01 敦煌莫高窟 156 窟〈張議潮統軍出行圖〉（裁兩處） | https://commons.wikimedia.org/wiki/File:Mogao_Cave_156_battle.jpg | 公有領域（PD-Art） | 晚唐佚名畫工；照片 茹遂初，1978 | 2026-10-21 |
| 02 敦煌晚唐壁畫，持長牌步兵出城（哪一窟待查） | https://commons.wikimedia.org/wiki/File:Dunhuang_Zhang_Yichao_departure_02.jpg | 公有領域（PD-Art） | 佚名畫工 | 2026-10-21 |
| 04 榆林窟 25 窟甲士 | https://commons.wikimedia.org/wiki/File:Yulin_caves,_Tang_cavalryman.jpg | 公有領域（PD-Art） | 9 世紀佚名畫工 | 2026-10-21 |
| 06 前蜀王建墓抬棺力士背面 | https://commons.wikimedia.org/wiki/File:Wang_Jian_Royal_Tomb_(13944716273).jpg | CC0 1.0 | Gary Todd | 2026-10-21 |

## 只做測試、不進任何公開發布的

| 工具 | 用在哪 | 授權與限制 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Tencent Hunyuan3D 2.1（Hugging Face 公開試用頁，不登入） | R7 版本 3：從我們自己算的概念圖生成模型，只做比較測試 | Tencent Hunyuan 3D 2.1 Community License：<br>• Tencent 對生成物不主張權利（6(d)）<br>• 歐盟、英國、南韓不適用，在那裡使用生成物不在授權範圍內（1(l)、5(c)）<br>• 月活躍用戶超過 100 萬要另外向 Tencent 申請（4）<br>• 不能用來改進其他 AI 模型（5(b)） | https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE | 2026-10-20 |

正式量產不會用 Hunyuan3D。它的生成物不放進任何 Release，用生成物算出來的比較圖也不放進這個 repo；使用者已經在電腦上看過。

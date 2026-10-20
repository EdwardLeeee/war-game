# 第三方素材與授權

遊戲本身保留所有權利（沒有開源授權）。下面是美術製作用到的外部素材。

每一項使用前都讀過官方授權原文，日期記在表裡。原始檔不進這個 repo：CI 照網址下載，核對 sha256。

## 用在出貨圖裡的素材

| 素材 | 用在哪 | 授權 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Poly Haven 貼圖 18 種（清單和每個檔的網址、sha256 在 `design/r7/common/textures.py`、`textures_sha.json`）：rough_linen、hessian_230、brown_leather、fabric_leather_02、metal_plate、rusty_metal_02、fine_grained_wood、medieval_wood、old_planks_02、castle_brick_01、clay_plaster、thatch_roof_angled、clay_roof_tiles_02、leafy_grass、aerial_grass_rock、stony_dirt_path、gravel_ground_01、brown_mud_rocks_01 | R7 寫實比較（D-092）：兵、建築、地面的材質，算進圖裡 | CC0 1.0（可商用，不用標示出處） | https://polyhaven.com/license | 2026-10-20 |
| MPFB 2.0.18（MakeHuman 的 Blender 外掛）的底模、變形、權重 | R7 版本 2：寫實人體 | 素材 CC0 1.0；官方寫明產出物不受任何限制 | https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md | 2026-10-20 |

MPFB 的程式本身是 GPLv3。我們只在 Blender 裡把它當工具用，沒有散布它的程式，遊戲裡也不含它的程式。下載網址：https://extensions.blender.org/add-ons/mpfb/，檔案 sha256 c075b3e9…2a2dad，和官方網址上的一致。

## 只做測試、不進任何公開發布的

| 工具 | 用在哪 | 授權與限制 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Tencent Hunyuan3D 2.1（Hugging Face 公開試用頁，不登入） | R7 版本 3：從我們自己算的概念圖生成模型，只做比較測試 | Tencent Hunyuan 3D 2.1 Community License：<br>• Tencent 對生成物不主張權利（6(d)）<br>• 歐盟、英國、南韓不適用，在那裡使用生成物不在授權範圍內（1(l)、5(c)）<br>• 月活躍用戶超過 100 萬要另外向 Tencent 申請（4）<br>• 不能用來改進其他 AI 模型（5(b)） | https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE | 2026-10-20 |

正式量產不會用 Hunyuan3D。它的生成物不放進任何 Release，用生成物算出來的比較圖也不放進這個 repo；使用者已經在電腦上看過。

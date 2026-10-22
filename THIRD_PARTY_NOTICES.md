# 第三方素材與授權

遊戲本身保留所有權利（沒有開源授權）。下面是美術製作用到的外部素材。

每一項使用前都讀過官方授權原文，日期記在表裡。原始檔不進這個 repo：CI 照網址下載，核對 sha256。

## 用在出貨圖裡的素材

| 素材 | 用在哪 | 授權 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Poly Haven 貼圖 21 種（清單和每個檔的網址、sha256 在 `design/r7/common/textures.py`、`textures_sha.json`）：rough_linen、hessian_230、brown_leather、fabric_leather_02、metal_plate、rusty_metal_02、fine_grained_wood、medieval_wood、old_planks_02、castle_brick_01、clay_plaster、thatch_roof_angled、clay_roof_tiles_02、leafy_grass、aerial_grass_rock、stony_dirt_path、gravel_ground_01、brown_mud_rocks_01、rock_face_03、lichen_rock、rustic_stone_wall_02 | R7 寫實比較（D-092）、R8（D-093）：兵、建築、懸崖、地面的材質，算進圖裡 | CC0 1.0（可商用，不用標示出處） | https://polyhaven.com/license | 2026-10-20 |
| MPFB 2.0.18（MakeHuman 的 Blender 外掛）的底模、變形、權重 | R7 版本 2：寫實人體 | 素材 CC0 1.0；官方寫明產出物不受任何限制 | https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md | 2026-10-20 |
| 寫實馬：Lyndon Daniels〈Realtime Rancher's 3D Model Pack〉的馬（網格、2k 顏色／法線／AO 貼圖、鬃毛和尾巴）；ChadM 加上骨架和權重的版本〈rigged horse〉。檔案 `horse.zip`（sha256 469704f5…0043d27）、`riggedHorse.blend`（sha256 9cca670b…7037f4a） | R8 騎兵的馬（`design/r8/blender/horse_r8.py`） | CC0 1.0（兩個頁面都標 CC0；rigged 版寫明「授權和 Lyndon 的原版相同」） | https://opengameart.org/content/realtime-ranchers-3d-model-pack 、 https://opengameart.org/content/rigged-horse | 2026-10-21 |

MPFB 的程式本身是 GPLv3。我們只在 Blender 裡把它當工具用，沒有散布它的程式，遊戲裡也不含它的程式。下載網址：https://extensions.blender.org/add-ons/mpfb/，檔案 sha256 c075b3e9…2a2dad，和官方網址上的一致。

## 只當參考、放在核准稿上的圖

R8 的核准稿（`design/r8/out/R8-*`）上方放了幾張裁切過的參考圖，給使用者對照。美術是照著重新做 3D，圖本身不放進遊戲。原檔不進 repo（ceo 的考據資料夾 `research/east-reference/`、`research/west-reference/`，各有授權清單 `LICENSES.md`；另外找的在 `design/r8/build/refs/`，不進 repo）。CC BY-SA、CC BY 的圖（東陸 07、08、09、13、14、15，西陸 03、07）只拿來看，不放進 repo，也不放進核准稿。

| 圖 | 來源頁 | 授權 | 作者 | 讀授權的日期 |
|---|---|---|---|---|
| 01 敦煌莫高窟 156 窟〈張議潮統軍出行圖〉（裁兩處） | https://commons.wikimedia.org/wiki/File:Mogao_Cave_156_battle.jpg | 公有領域（PD-Art） | 晚唐佚名畫工；照片 茹遂初，1978 | 2026-10-21 |
| 02 敦煌晚唐壁畫，持長牌步兵出城（哪一窟待查） | https://commons.wikimedia.org/wiki/File:Dunhuang_Zhang_Yichao_departure_02.jpg | 公有領域（PD-Art） | 佚名畫工 | 2026-10-21 |
| 04 榆林窟 25 窟甲士 | https://commons.wikimedia.org/wiki/File:Yulin_caves,_Tang_cavalryman.jpg | 公有領域（PD-Art） | 9 世紀佚名畫工 | 2026-10-21 |
| 06 前蜀王建墓抬棺力士背面 | https://commons.wikimedia.org/wiki/File:Wang_Jian_Royal_Tomb_(13944716273).jpg | CC0 1.0 | Gary Todd | 2026-10-21 |
| 北魏甲馬騎俑 20.39.2、20.39.3（具裝騎兵稿） | https://www.metmuseum.org/art/collection/search/52555 、 https://www.metmuseum.org/art/collection/search/52556 | CC0 1.0（大都會博物館 Open Access，API 標 isPublicDomain） | 大都會博物館 | 2026-10-21 |
| 隋唐之際馬伕俑 1970.58（東陸村民稿） | https://clevelandart.org/art/1970.58 | CC0 1.0（克里夫蘭美術館 Open Access） | 克里夫蘭美術館 | 2026-10-21 |
| 〈道釋圖冊〉第 20 開 2004.1.20（東陸術士稿） | https://clevelandart.org/art/2004.1.20 | CC0 1.0（克里夫蘭美術館 Open Access） | 克里夫蘭美術館 | 2026-10-21 |
| 《武經總要》〈旋風五砲〉、〈虎蹲砲〉（霹靂車稿） | https://commons.wikimedia.org/wiki/File:Xuanfengwupao.jpg 、 https://commons.wikimedia.org/wiki/File:Hudunpao-wujingzongyao.jpg | 公有領域 | 曾公亮、丁度等（1044） | 2026-10-21 |
| 西陸 05、06（裁三處）、11：摩根聖經 MS M.638 10r、23v、17v | 見 `research/west-reference/LICENSES.md` 的來源頁 | 公有領域 | 13 世紀中葉巴黎佚名畫工 | 2026-10-21 |
| 西陸 08：達伯農銅像版畫 | 同上 | 公有領域 | 19 世紀佚名版畫 | 2026-10-21 |
| 西陸 10、12：勒特雷爾詩篇（長弓練習、打穀 f.74v） | 同上 | 10 公有領域；12 CC0（大英圖書館） | 約 1325–35 佚名畫工 | 2026-10-21 |
| 西陸 13：卡斯泰爾諾城堡的重建配重投石機 | 同上 | CC0 | Jebulon | 2026-10-21 |
| 西陸 14：托雷多道德化聖經獻辭頁（摩根圖書館 M.240） | 同上 | 公有領域 | 1227–34 巴黎佚名畫工 | 2026-10-21 |
| 西陸 15：沃爾托利納〈波隆那大學講課〉 | 同上 | 公有領域標章（收藏館標示） | Laurentius de Voltolina | 2026-10-21 |
| 城牆 02：史坦威克斯堡重建，胸牆內側的站台（牆上的兵稿 R8-15、R8-16） | https://commons.wikimedia.org/wiki/File:Fort_Stanwix_National_Monument_FTST3695.jpg | 公有領域（美國國家公園管理局照片） | National Park Service | 2026-10-22 |
| 城牆 03：史坦威克斯堡從外面看 | https://commons.wikimedia.org/wiki/File:Fort_Stanwix,_Rome_NY_-_interior.jpg | 公有領域（作者放棄權利） | Ernest Mettendorf | 2026-10-22 |
| 城牆 05：迪利希《Peribologia》1641 剖面 | https://commons.wikimedia.org/wiki/File:Fotothek_df_tg_0008986_Architektur_%5E_Geometrie_%5E_Festungsbau_%5E_Befestigung_%5E_Schanze_%5E_Wall_%5E_Graben.jpg | 公有領域 | Wilhelm Dilich；掃描 Deutsche Fotothek | 2026-10-22 |
| 城牆 06：《武經總要》〈城制〉 | https://commons.wikimedia.org/wiki/File:武经总要_曾公亮和丁度_宋朝_二_36.jpg | 公有領域（PD-Art） | 曾公亮、丁度等（1044）；《四庫全書》本重繪 | 2026-10-22 |
| 城牆 09：西安明城牆頂 | https://commons.wikimedia.org/wiki/File:Xi'an_City_Wall_(9911940185).jpg | CC0 1.0 | Gary Todd | 2026-10-22 |
| 城牆 14：維奧萊勒杜克〈垛口〉卡卡松 | https://commons.wikimedia.org/wiki/File:Creneau.Carcassonne.png | 公有領域 | Viollet-le-Duc《法國建築辭典》，刻版 Pégard | 2026-10-22 |
| 東陸建築 01：佛光寺東大殿模型（R8 第二批樣本 R8-21） | https://commons.wikimedia.org/wiki/File:Main_Hall_at_Foguang_Temple_(9833583045).jpg | CC0 1.0 | Gary Todd | 2026-10-22 |
| 東陸建築 03：南禪寺大殿模型 | https://commons.wikimedia.org/wiki/File:Main_Hall_at_Nanchan_Temple_(9833585145).jpg | CC0 1.0 | Gary Todd | 2026-10-22 |
| 東陸建築 08：懿德太子墓壁畫闕樓 | https://commons.wikimedia.org/wiki/File:Prince_Yide's_tomb,_towers.jpg | 公有領域（PD-Art） | 唐代佚名畫工（706） | 2026-10-22 |
| 東陸建築 09：隋唐陶屋 | https://commons.wikimedia.org/wiki/File:Sui_or_Tang_Pottery_House_&_Roof_Tiles.jpg | CC0 1.0 | Gary Todd | 2026-10-22 |
| 東陸建築 10：唐三彩院落模型 | https://commons.wikimedia.org/wiki/File:Tang_Glazed_Pottery_House_(9924297526).jpg | CC0 1.0 | Gary Todd | 2026-10-22 |
| 東陸建築 12：《營造法式》殿堂側樣 | https://commons.wikimedia.org/wiki/File:營造法式一_40.jpg | 公有領域（PD-Art） | 李誡（1103）；《四庫全書》本重繪 | 2026-10-22 |
| 西陸建築 07：伊珀爾布料大廳與鐘樓（R8-22） | https://commons.wikimedia.org/wiki/File:Louis-Auguste_Bisson_-_Ypres,_Belgium_-_1986.37_-_Cleveland_Museum_of_Art.jpg | 公有領域 | Bisson 兄弟（1855–62）；克里夫蘭美術館 | 2026-10-22 |
| 西陸建築 10：奧克姆城堡大廳版畫 | https://commons.wikimedia.org/wiki/File:Image-taken-from-page-30-of-england-delineated_10999886754_o.jpg | CC0 1.0 | 大英圖書館掃描；版畫 Metcalf | 2026-10-22 |
| 西陸建築 09：維奧萊勒杜克〈住宅〉維托民居 | https://commons.wikimedia.org/wiki/File:Maison.XIIIe.siecle.Vitteaux.png | 公有領域 | Viollet-le-Duc | 2026-10-22 |
| 西陸建築 11：大科克斯韋爾穀倉 | https://commons.wikimedia.org/wiki/File:Greatbarn-greatcoxwell-01.jpg | 公有領域（作者放棄權利） | TheCreator | 2026-10-22 |
| 西陸建築 03：維拉爾手稿的屋架 | https://commons.wikimedia.org/wiki/File:Villard_de_Honnecourt_Album_de_..._charpente._BNF.jpg | CC0 1.0 | Villard de Honnecourt；掃描 Gallica／BnF | 2026-10-22 |
| 西陸建築 13：勒特雷爾詩篇的編籬羊圈 | https://commons.wikimedia.org/wiki/File:Sheep_pen_(Luttrell_Psalter).png | 公有領域（PD-Art） | 約 1325–35 佚名畫工 | 2026-10-22 |
| 懸崖 11：太行山紅砂岩（R8-24） | https://commons.wikimedia.org/wiki/File:Dong_Taihang_10.jpg | CC0 1.0 | H2v5o68z | 2026-10-22 |
| 懸崖 12：猊鼻溪石灰岩崖 | https://commons.wikimedia.org/wiki/File:Geibikei_-_Geibikei7679.jpg | CC0 1.0 | lumoplank | 2026-10-22 |
| 懸崖 13：石灰岩崖腳的岩屑錐 | https://commons.wikimedia.org/wiki/File:Begunjscica,_Born_Path_traversing_a_scree_03.jpg | CC0 1.0 | Ajznponar | 2026-10-22 |

## 只做測試、不進任何公開發布的

| 工具 | 用在哪 | 授權與限制 | 授權原文 | 讀授權的日期 |
|---|---|---|---|---|
| Tencent Hunyuan3D 2.1（Hugging Face 公開試用頁，不登入） | R7 版本 3：從我們自己算的概念圖生成模型，只做比較測試 | Tencent Hunyuan 3D 2.1 Community License：<br>• Tencent 對生成物不主張權利（6(d)）<br>• 歐盟、英國、南韓不適用，在那裡使用生成物不在授權範圍內（1(l)、5(c)）<br>• 月活躍用戶超過 100 萬要另外向 Tencent 申請（4）<br>• 不能用來改進其他 AI 模型（5(b)） | https://huggingface.co/tencent/Hunyuan3D-2.1/blob/main/LICENSE | 2026-10-20 |

正式量產不會用 Hunyuan3D。它的生成物不放進任何 Release，用生成物算出來的比較圖也不放進這個 repo；使用者已經在電腦上看過。

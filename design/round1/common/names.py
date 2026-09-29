"""Display names and file labels shared by every option."""

UNIT_NAMES = {
    "farmer_e": "農夫", "spear_e": "槍兵", "pike_w": "長矛兵", "xbow_e": "弩手", "bow_w": "長弓兵",
    "hcav_e": "具裝騎兵", "knight_w": "騎士", "siege_e": "霹靂車", "siege_w": "投石機", "mage_e": "術士",
}
RULER_ORDER = ["farmer_e", "spear_e", "pike_w", "xbow_e", "bow_w", "hcav_e", "knight_w", "siege_e", "siege_w",
               "mage_e"]

OPTIONS = {
    "A": dict(name="彩繪桌遊", tone="明亮", pipeline="純 2D：程式畫向量零件，零件旋轉位移做動畫"),
    "B": dict(name="立體微縮", tone="中間偏暖", pipeline="先做 3D 模型再算成 2D 圖（世紀帝國二的做法）"),
    "C": dict(name="水墨戰卷", tone="紙白墨黑、只有玩家色與魔法上色（高反差）",
              pipeline="和 B 共用 3D 模型，畫成濃淡墨＋毛筆輪廓，合成在宣紙上"),
}


def label(opt, suffix):
    return f"R1-01-畫面風格-{opt}-{OPTIONS[opt]['name']}-{suffix}"


def body_pt(top_m, pt_per_m=20):
    """Height on screen of a point top_m metres above the ground (camera 30 degrees up)."""
    return top_m * 0.866 * pt_per_m

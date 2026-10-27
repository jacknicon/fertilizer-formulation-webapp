/**
 * 化成肥料・BB肥料 処方設計＆成分限界シミュレーター マスターデータ
 *
 * 各成分含有率は重量百分率 (%)
 * N: 窒素全量(T-N), AN: アンモニア性窒素, UN: 尿素性窒素, NN: 硝酸性窒素
 * P: リン酸全量(T-P2O5), WP: 水溶性リン酸(W-P2O5), CP: く溶性リン酸(C-P2O5)
 * K: カリ(K2O), Mg: 苦土(MgO), Ca: 石灰(CaO), Si: ケイ酸(SiO2), Mn: マンガン(MnO), B: ホウ素(B2O3)
 * pricePerTon: 1トン(1,000kg)あたりの参考原料価格(円)
 */
window.MASTER_FERTILIZER_DB = {
  version: "2.0.0",
  updatedAt: "2026-10-27",

  // チェックボックスで選択可能な化学的・物理的特性フラグ定義
  flagDefinitions: [
    {
      id: "has_an",
      group: "窒素・リン酸形態",
      label: "アンモニア態窒素(A-N)を含む",
      desc: "アルカリ性資材と混合するとアンモニアガスが揮散し窒素損失・固結を起こす"
    },
    {
      id: "has_un",
      group: "窒素・リン酸形態",
      label: "尿素態窒素(U-N)を含む",
      desc: "過石・重過石（遊離酸/結晶水）と混合すると泥状化・吸湿固化、硝安と混合すると著しく潮解する"
    },
    {
      id: "has_nn",
      group: "窒素・リン酸形態",
      label: "硝酸態窒素(N-N)を含む",
      desc: "吸湿・潮解性が強く、尿素や酸性原料・有機物との配合に注意が必要"
    },
    {
      id: "has_cyanamide",
      group: "窒素・リン酸形態",
      label: "シアナミド態窒素を含む（石灰窒素等）",
      desc: "強アルカリ性であり、アンモニア態窒素の揮散および水溶性リン酸の退行（不溶化）を起こす"
    },
    {
      id: "has_wp",
      group: "窒素・リン酸形態",
      label: "水溶性リン酸(W-P₂O₅)を含む",
      desc: "アルカリ性資材や石灰分と反応すると難溶性リン酸へ退行（不溶化）する"
    },
    {
      id: "has_free_acid",
      group: "窒素・リン酸形態",
      label: "遊離酸・結晶水を含む（過石・重過石等）",
      desc: "尿素と反応して結晶水を遊離し泥状化させる。炭酸カルシウム等と反応して発泡・発熱する"
    },
    {
      id: "is_strong_alkali",
      group: "酸・アルカリ反応特性",
      label: "強アルカリ性資材（消石灰・生石灰・草木灰等）",
      desc: "アンモニア態窒素および水溶性リン酸との混合は厳禁（配合禁忌）"
    },
    {
      id: "is_weak_alkali",
      group: "酸・アルカリ反応特性",
      label: "弱アルカリ・塩基性資材（ようりん・ケイカル・苦土石灰・水マグ・炭カル等）",
      desc: "アンモニア態窒素・水溶性リン酸との多量配合時はアンモニア臭やリン酸退行に注意（配合率制限推奨）"
    },
    {
      id: "is_hygroscopic",
      group: "物理性・副成分・用途",
      label: "吸湿・潮解性が高い（低CRH原料）",
      desc: "高湿度下で吸湿・固結しやすい。他の吸湿性原料との多量併用時は防湿袋・固結防止処理が必要"
    },
    {
      id: "has_chlorine",
      group: "物理性・副成分・用途",
      label: "塩素(Cl)を含む（塩加・塩安等）",
      desc: "「硫酸系（塩素フリー）」銘柄を設計する際には使用不可"
    },
    {
      id: "is_organic",
      group: "物理性・副成分・用途",
      label: "有機質原料（動植物由来）",
      desc: "有機入り化成・有機配合の有機率計算に算入される"
    },
    {
      id: "is_powder",
      group: "物理性・副成分・用途",
      label: "粉状・微粉原料（BB配合時の分級注意）",
      desc: "粒状のBB肥料にそのまま混ぜると袋内で分級（偏析）するため、造粒品を使うか化成造粒向けとする"
    },
    {
      id: "is_filler",
      group: "物理性・副成分・用途",
      label: "増量材（フィラー・1000kg調整材）として使用可能",
      desc: "目標成分を満たした後の残余重量（100%までの空き枠）を埋めるバランス調整材として利用できる"
    }
  ],

  categories: [
    { id: "n_source", name: "窒素質原料 (N源)" },
    { id: "np_p_source", name: "リン酸・複合中間原料 (N-P / P源)" },
    { id: "k_source", name: "カリ質・NK原料 (K源)" },
    { id: "mg_ca_micro", name: "苦土・石灰・ケイ酸・微量要素" },
    { id: "organic", name: "有機質原料（油かす・魚粉・骨粉等）" },
    { id: "filler", name: "増量材・フィラー（重量調整材）" }
  ],

  materials: [
    // ================= 1. 窒素質原料 (N源) =================
    {
      id: "urea",
      name: "尿素（粒状）",
      category: "n_source",
      N: 46.0, AN: 0, UN: 46.0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 98000,
      flags: ["has_un", "is_hygroscopic"],
      forbiddenWith: ["single_superphosphate", "triple_superphosphate", "ammonium_nitrate"],
      cautionWith: [],
      note: "最高濃度のN源（46%）。高成分銘柄の必須原料だが、過石・重過石と直接混ぜると遊離酸・結晶水と反応してベタベタに泥状化するため配合禁忌（りん安との配合は可）。"
    },
    {
      id: "ammonium_sulfate",
      name: "硫安（硫酸アンモニウム）",
      category: "n_source",
      N: 21.0, AN: 21.0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 52000,
      flags: ["has_an"],
      forbiddenWith: [],
      cautionWith: [],
      note: "化学的に極めて安定しており吸湿しにくい優秀なアンモニア態N源。ただしNが21%と低いため、硫安単体では高N銘柄（N16%以上など）は100%枠を超えてしまい作れない。"
    },
    {
      id: "ammonium_chloride",
      name: "塩安（塩化アンモニウム）",
      category: "n_source",
      N: 25.0, AN: 25.0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 56000,
      flags: ["has_an", "has_chlorine"],
      forbiddenWith: [],
      cautionWith: [],
      note: "硫安よりN濃度がやや高い（25%）。水稲用化成・BB肥料で多用されるが塩素を含む。"
    },
    {
      id: "ammonium_nitrate",
      name: "硝安（硝酸アンモニウム）",
      category: "n_source",
      N: 34.0, AN: 17.0, UN: 0, NN: 17.0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 95000,
      flags: ["has_an", "has_nn", "is_hygroscopic"],
      forbiddenWith: ["urea"],
      cautionWith: [],
      note: "尿素と混ぜると臨界相対湿度(CRH)が18%まで低下し、空気中の水分を吸って瞬時に液化（潮解）するため尿素との配合は厳禁。"
    },
    {
      id: "coated_urea_lp",
      name: "被覆尿素（LPコート等）",
      category: "n_source",
      N: 42.0, AN: 0, UN: 42.0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 195000,
      flags: ["has_un"],
      forbiddenWith: [],
      cautionWith: [],
      note: "樹脂被膜で保護されているため、通常の生尿素と異なり過石等とのBB配合でも泥状化しにくい緩効性N原料。"
    },
    {
      id: "ibdu",
      name: "IB窒素（IBDU）",
      category: "n_source",
      N: 31.0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 175000,
      flags: [],
      forbiddenWith: [],
      cautionWith: [],
      note: "加水分解型の合成緩効性窒素（31%）。化学的に安定で他原料との配合相性が良い。"
    },
    {
      id: "calcium_cyanamide",
      name: "石灰窒素（粒状）",
      category: "n_source",
      N: 21.0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 55.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 135000,
      flags: ["has_cyanamide", "is_strong_alkali"],
      forbiddenWith: [],
      cautionWith: [],
      note: "強アルカリ性のため、アンモニア態N原料（硫安・りん安）や水溶性P原料（過石・重過石）とは混合不可。ようりんや塩加との配合は可能。"
    },

    // ================= 2. リン酸・複合中間原料 (N-P / P源) =================
    {
      id: "dap",
      name: "DAP（第二リン酸アンモニウム 18-46-0）",
      category: "np_p_source",
      N: 18.0, AN: 18.0, UN: 0, NN: 0,
      P: 46.0, WP: 41.0, CP: 46.0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 118000,
      flags: ["has_an", "has_wp"],
      forbiddenWith: [],
      cautionWith: [],
      note: "BB肥料・高度化成の主力中間原料。1トンあたりN 18%とP₂O₅ 46%を同時に供給でき、尿素との相性も良いため高成分銘柄（15-15-15〜18-18-18等）の製造に不可欠。"
    },
    {
      id: "map",
      name: "MAP（第一リン酸アンモニウム 11-50-0）",
      category: "np_p_source",
      N: 11.0, AN: 11.0, UN: 0, NN: 0,
      P: 50.0, WP: 44.0, CP: 50.0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 122000,
      flags: ["has_an", "has_wp"],
      forbiddenWith: [],
      cautionWith: [],
      note: "DAPよりリン酸濃度が高く（50%）、Nを抑えてPを高くしたい山型銘柄（8-24-16等）や尿素配合に極めて使いやすい。"
    },
    {
      id: "triple_superphosphate",
      name: "重過リン酸石灰（重過石 35%）",
      category: "np_p_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 35.0, WP: 30.0, CP: 35.0,
      K: 0, Mg: 0, Ca: 16.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 96000,
      flags: ["has_wp", "has_free_acid"],
      forbiddenWith: ["urea"],
      cautionWith: [],
      note: "窒素を含まない高濃度リン酸源（35%）。Nをゼロまたは極小にしたいPK化成や低N銘柄に必須だが、生尿素と混ぜると泥状化するため注意。"
    },
    {
      id: "single_superphosphate",
      name: "過リン酸石灰（過石 17.5%）",
      category: "np_p_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 17.5, WP: 14.5, CP: 17.5,
      K: 0, Mg: 0, Ca: 28.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 64000,
      flags: ["has_wp", "has_free_acid"],
      forbiddenWith: ["urea"],
      cautionWith: [],
      note: "普通化成（8-8-8等）の定番リン酸原料。濃度が17.5%と低いため、過石だけでP12%以上を作ろうとすると重量枠の大半を消費する。"
    },
    {
      id: "fused_magnesium_phosphate",
      name: "ようりん（熔成リン肥 20%）",
      category: "np_p_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 20.0, WP: 0, CP: 20.0,
      K: 0, Mg: 15.0, Ca: 30.0, Si: 20.0, Mn: 0, B: 0,
      pricePerTon: 82000,
      flags: ["is_weak_alkali"],
      forbiddenWith: [],
      cautionWith: [],
      note: "く溶性リン酸20%＋く溶性苦土15%＋ケイ酸20%。塩基性のため、硫安やりん安・過石と多量に混ぜるとアンモニア臭や水溶性リン酸の退行が起きる（BB配合では配合率制限または粒状品使用）。"
    },
    {
      id: "multi_phosphate",
      name: "重焼リン（35%）",
      category: "np_p_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 35.0, WP: 14.0, CP: 35.0,
      K: 0, Mg: 4.5, Ca: 34.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 112000,
      flags: ["has_wp", "is_weak_alkali"],
      forbiddenWith: [],
      cautionWith: [],
      note: "く溶性リン酸主体（35%）ながら水溶性リン酸も14%含む高濃度リン酸資材。"
    },

    // ================= 3. カリ質・NK原料 (K源) =================
    {
      id: "potassium_chloride",
      name: "塩化カリ（MOP 60%）",
      category: "k_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 60.0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 88000,
      flags: ["has_chlorine"],
      forbiddenWith: [],
      cautionWith: [],
      note: "最高濃度のカリ源（60%）。少ない重量枠で高いK成分を達成できるため高度化成・BB肥料の基本原料となる。"
    },
    {
      id: "potassium_sulfate",
      name: "硫酸カリ（SOP 50%）",
      category: "k_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 50.0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 115000,
      flags: [],
      forbiddenWith: [],
      cautionWith: [],
      note: "塩素を含まないカリ源（50%）。塩加より濃度が10%低いため、高K銘柄では塩加よりも必要重量枠が1.2倍大きくなる。"
    },
    {
      id: "potassium_magnesium_sulfate",
      name: "硫酸カリ苦土（22-10）",
      category: "k_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 22.0, Mg: 10.0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 98000,
      flags: [],
      forbiddenWith: [],
      cautionWith: [],
      note: "水溶性カリ(22%)と水溶性苦土(10%)を同時供給できる塩素フリー原料。"
    },
    {
      id: "potassium_silicate",
      name: "ケイ酸カリ（20%）",
      category: "k_source",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 20.0, Mg: 4.0, Ca: 0, Si: 32.0, Mn: 0, B: 0,
      pricePerTon: 94000,
      flags: ["is_weak_alkali"],
      forbiddenWith: [],
      cautionWith: [],
      note: "く溶性カリ20%＋可溶性ケイ酸32%。アルカリ性のため酸性原料との多量配合時は注意。"
    },
    {
      id: "potassium_nitrate",
      name: "硝酸カリウム（13.5-0-45）",
      category: "k_source",
      N: 13.5, AN: 0, UN: 0, NN: 13.5,
      P: 0, WP: 0, CP: 0,
      K: 45.0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 185000,
      flags: ["has_nn"],
      forbiddenWith: [],
      cautionWith: [],
      note: "硝酸態窒素とカリを同時に供給する高級原料。追肥用NK化成や水溶性肥料の設計に使用。"
    },

    // ================= 4. 苦土・石灰・ケイ酸・微量要素 =================
    {
      id: "magnesium_hydroxide",
      name: "水酸化マグネシウム（水マグ 58%）",
      category: "mg_ca_micro",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 58.0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 95000,
      flags: ["is_weak_alkali"],
      forbiddenWith: [],
      cautionWith: [],
      note: "最高濃度のく溶性苦土源（58%）。わずか5.2%（52kg/t）の配合で苦土3%保証を達成できるため、高成分化成・BB肥料の苦土添加に最も使われる。"
    },
    {
      id: "magnesium_sulfate",
      name: "硫酸マグネシウム（硫マグ 20%）",
      category: "mg_ca_micro",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 20.0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 78000,
      flags: [],
      forbiddenWith: [],
      cautionWith: [],
      note: "中性の水溶性苦土源（20%）。アンモニア態窒素や水溶性リン酸と混ぜても化学反応（退行や揮散）を起こさない安全な苦土原料。"
    },
    {
      id: "dolomite_lime",
      name: "苦土石灰（粒状ドロマイト）",
      category: "mg_ca_micro",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 15.0, Ca: 35.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 32000,
      flags: ["is_weak_alkali", "is_filler"],
      forbiddenWith: [],
      cautionWith: [],
      note: "苦土補給兼アルカリ性増量材としても利用されるが、過石や硫安との多量混合時は反応に注意。"
    },
    {
      id: "slaked_lime",
      name: "消石灰",
      category: "mg_ca_micro",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 65.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 45000,
      flags: ["is_strong_alkali", "is_powder"],
      forbiddenWith: [],
      cautionWith: [],
      note: "強アルカリ性のため、アンモニア態窒素（硫安・塩安・りん安）や水溶性リン酸（過石・重過石）との配合は厳禁。"
    },
    {
      id: "fte",
      name: "FTE（微量要素ガラスフリット）",
      category: "mg_ca_micro",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 18.0, B: 8.0,
      pricePerTon: 240000,
      flags: [],
      forbiddenWith: [],
      cautionWith: [],
      note: "く溶性マンガン18%・く溶性ホウ素8%を含有。微量要素入り銘柄（Mn 0.5%, B 0.2%等）の設計に数%配合する。"
    },

    // ================= 5. 有機質原料 =================
    {
      id: "rapeseed_meal",
      name: "菜種油かす（粉末/ペレット）",
      category: "organic",
      N: 5.3, AN: 0, UN: 0, NN: 0,
      P: 2.0, WP: 0, CP: 0,
      K: 1.0, Mg: 0.5, Ca: 0.8, Si: 0, Mn: 0, B: 0,
      pricePerTon: 78000,
      flags: ["is_organic"],
      forbiddenWith: [],
      cautionWith: [],
      note: "代表的な植物性有機原料。Nが5.3%と低いため、「有機態窒素率50%以上」かつ「高N（例：12%以上）」を同時に満たそうとすると100%枠を超えて製造不能になりやすい。"
    },
    {
      id: "fish_meal",
      name: "魚かす（魚粉ペレット）",
      category: "organic",
      N: 8.0, AN: 0, UN: 0, NN: 0,
      P: 6.0, WP: 0, CP: 0,
      K: 0.5, Mg: 0.3, Ca: 6.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 165000,
      flags: ["is_organic"],
      forbiddenWith: [],
      cautionWith: [],
      note: "動物性有機原料。菜種油かすよりN(8%)・P(6%)が高いため、有機入り化成で有機比率を高める際に有利。"
    },
    {
      id: "steamed_bone_meal",
      name: "蒸製骨粉",
      category: "organic",
      N: 4.0, AN: 0, UN: 0, NN: 0,
      P: 20.0, WP: 0, CP: 18.0,
      K: 0, Mg: 0.5, Ca: 26.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 125000,
      flags: ["is_organic"],
      forbiddenWith: [],
      cautionWith: [],
      note: "有機質リン酸源（P 20%）。有機100%配合肥料でリン酸を高めたい場合の必須原料。"
    },
    {
      id: "feather_meal",
      name: "フェザーミール（蒸製毛粉）",
      category: "organic",
      N: 12.5, AN: 0, UN: 0, NN: 0,
      P: 0.5, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0.5, Si: 0, Mn: 0, B: 0,
      pricePerTon: 130000,
      flags: ["is_organic"],
      forbiddenWith: [],
      cautionWith: [],
      note: "高濃度の有機態窒素源（N 12.5%）。少ない配合重量で有機態Nを稼げるため、有機入り高成分化成の処方設計で極めて重宝する。"
    },

    // ================= 6. 増量材・フィラー（1,000kg バランス調整材） =================
    {
      id: "filler_clay",
      name: "クレー・カオリン（不活性増量材）",
      category: "filler",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 18000,
      flags: ["is_filler"],
      forbiddenWith: [],
      cautionWith: [],
      note: "化学的に完全に不活性な増量材（フィラー）および化成造粒バインダー。どの原料とも反応せず、1,000kg（100%）の残余重量を安全に埋めることができる。"
    },
    {
      id: "filler_gypsum",
      name: "石膏（硫酸カルシウム・中性増量材）",
      category: "filler",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 30.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 25000,
      flags: ["is_filler"],
      forbiddenWith: [],
      cautionWith: [],
      note: "中性のためアンモニア態窒素や水溶性リン酸と反応しない安全な増量材・造粒補助材。副成分として石灰(CaO 30%)も付与できる。"
    },
    {
      id: "filler_zeolite",
      name: "ゼオライト（粒状・保肥性増量材）",
      category: "filler",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 1.0, Mg: 0.5, Ca: 1.5, Si: 0, Mn: 0, B: 0,
      pricePerTon: 28000,
      flags: ["is_filler"],
      forbiddenWith: [],
      cautionWith: [],
      note: "粒状BB肥料の増量材および固結防止・CEC付与材として好適。化学反応を起こさず粒径も揃えやすい。"
    },
    {
      id: "filler_calcium_carbonate",
      name: "炭酸カルシウム（重カル・増量材）",
      category: "filler",
      N: 0, AN: 0, UN: 0, NN: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 53.0, Si: 0, Mn: 0, B: 0,
      pricePerTon: 16000,
      flags: ["is_weak_alkali", "is_filler"],
      forbiddenWith: [],
      cautionWith: [],
      note: "安価な増量材だが弱アルカリ性のため、遊離酸を持つ過石・重過石と混ぜると炭酸ガス発泡やリン酸退行を起こすことがある。"
    }
  ],

  // よく検討される代表的な銘柄プリセット
  gradePresets: [
    {
      id: "grade_8_8_8",
      name: "普通化成 8-8-8（硫安・過石・塩加ベース）",
      target: { N: 8.0, P: 8.0, K: 8.0, Mg: 0 },
      recipe: [
        { id: "ammonium_sulfate", ratio: 38.5 },
        { id: "single_superphosphate", ratio: 46.0 },
        { id: "potassium_chloride", ratio: 13.5 },
        { id: "filler_gypsum", ratio: 2.0 }
      ]
    },
    {
      id: "grade_15_15_15",
      name: "高度化成・BB 15-15-15（尿素・DAP・塩加ベース）",
      target: { N: 15.0, P: 15.0, K: 15.0, Mg: 0 },
      recipe: [
        { id: "dap", ratio: 32.8 },
        { id: "urea", ratio: 20.0 },
        { id: "potassium_chloride", ratio: 25.2 },
        { id: "filler_zeolite", ratio: 22.0 }
      ]
    },
    {
      id: "grade_20_20_20_limit",
      name: "【限界検証】超高成分 20-20-20（100%超過で製造不可の例）",
      target: { N: 20.0, P: 20.0, K: 20.0, Mg: 0 },
      recipe: [
        { id: "dap", ratio: 43.5 },
        { id: "urea", ratio: 26.5 },
        { id: "potassium_chloride", ratio: 33.4 }
      ]
    },
    {
      id: "grade_12_16_14_mg3",
      name: "苦土入り高度 12-16-14-苦土3（塩素フリー硫酸系）",
      target: { N: 12.0, P: 16.0, K: 14.0, Mg: 3.0 },
      recipe: [
        { id: "map", ratio: 32.0 },
        { id: "ammonium_sulfate", ratio: 40.5 },
        { id: "potassium_sulfate", ratio: 28.0 },
        { id: "magnesium_hydroxide", ratio: 5.2 }
      ]
    },
    {
      id: "grade_organic_8_8_8",
      name: "有機入り化成 8-8-8（有機態N 40%配合・ギリギリ成立例）",
      target: { N: 8.0, P: 8.0, K: 8.0, Mg: 0 },
      recipe: [
        { id: "rapeseed_meal", ratio: 30.0 },
        { id: "fish_meal", ratio: 20.0 },
        { id: "dap", ratio: 13.5 },
        { id: "urea", ratio: 9.2 },
        { id: "potassium_sulfate", ratio: 15.2 },
        { id: "filler_clay", ratio: 12.1 }
      ]
    }
  ]
};

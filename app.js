/**
 * 化成肥料・BB肥料 処方設計＆成分限界シミュレーター (FertiFormulate Pro v2.2)
 */
(function () {
  const STORAGE_MASTER_KEY = "fertiformulate_master_materials_v22";
  const STORAGE_ADMIN_TOKEN = "fertiformulate_admin_unlocked";
  const STORAGE_APP_GATE_KEY = "fertiformulate_app_gate_unlocked_v1";
  const APP_GATE_PASSCODE = "miyazawakenji";
  const ADMIN_PASSCODE = "admin1234";

  const SEGMENT_COLORS = [
    "#1d4ed8", "#d97706", "#ca8a04", "#0d9488", "#7c3aed", "#db2777", "#475569", "#15803d"
  ];

  // 追加可能な副成分・微量要素の定義と初期デフォルト目標値
  const EXTRA_NUTRIENT_DEFS = [
    { key: "Ca", label: "石灰 (CaO)", short: "CaO", step: 0.5, defaultTarget: 10.0, sourceId: "filler_calcium_carbonate" },
    { key: "Si", label: "ケイ酸 (SiO₂)", short: "SiO₂", step: 0.5, defaultTarget: 10.0, sourceId: "calcium_silicate" },
    { key: "S", label: "硫黄 (S)", short: "S", step: 0.5, defaultTarget: 5.0, sourceId: "filler_gypsum" },
    { key: "Mn", label: "マンガン (MnO)", short: "MnO", step: 0.1, defaultTarget: 0.5, sourceId: "manganese_sulfate" },
    { key: "B", label: "ホウ素 (B₂O₃)", short: "B₂O₃", step: 0.05, defaultTarget: 0.2, sourceId: "borax" },
    { key: "Fe", label: "鉄 (Fe)", short: "Fe", step: 0.1, defaultTarget: 0.5, sourceId: "ferrous_sulfate" },
    { key: "Zn", label: "亜鉛 (Zn)", short: "Zn", step: 0.05, defaultTarget: 0.1, sourceId: "zinc_sulfate" },
    { key: "Cu", label: "銅 (Cu)", short: "Cu", step: 0.05, defaultTarget: 0.1, sourceId: "copper_sulfate" },
    { key: "Mo", label: "モリブデン (Mo)", short: "Mo", step: 0.01, defaultTarget: 0.05, sourceId: "sodium_molybdate" }
  ];

  const ALL_NUTRIENT_KEYS = ["N", "P", "K", "Mg", "Ca", "Si", "S", "Mn", "B", "Fe", "Zn", "Cu", "Mo"];

  const state = {
    isAdmin: sessionStorage.getItem(STORAGE_ADMIN_TOKEN) === "true",
    target: {
      N: 15.0, P: 15.0, K: 15.0, Mg: 0.0,
      Ca: 0, Si: 0, S: 0, Mn: 0, B: 0, Fe: 0, Zn: 0, Cu: 0, Mo: 0
    },
    enabledExtras: [], // 例: ["Mn", "B", "Fe"]
    overageMode: "none", // none | plus_02 | plus_03 | mult_103
    requireChlorineFree: false,
    recipe: [],
    recipeCategoryFilter: "all",
    masterSearch: ""
  };

  // ==================== マスターデータのロード・保存 ====================
  function initMasterDatabase() {
    try {
      const saved = localStorage.getItem(STORAGE_MASTER_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          window.MASTER_FERTILIZER_DB.materials = parsed;
        }
      }
    } catch (e) {
      console.warn("Failed to load custom master DB from storage:", e);
    }
  }

  function saveMasterDatabaseToStorage() {
    try {
      localStorage.setItem(STORAGE_MASTER_KEY, JSON.stringify(window.MASTER_FERTILIZER_DB.materials));
      if (state.isAdmin) {
        fetch("/api/materials", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Admin-Passcode": ADMIN_PASSCODE
          },
          body: JSON.stringify({ materials: window.MASTER_FERTILIZER_DB.materials })
        }).catch(() => {});
      }
    } catch (e) {
      console.warn("Storage save error:", e);
    }
  }

  function getMaterial(id) {
    return window.MASTER_FERTILIZER_DB.materials.find((m) => m.id === id);
  }

  function round1(val) {
    return Math.round((val + Number.EPSILON) * 10) / 10;
  }

  function round2(val) {
    return Math.round((val + Number.EPSILON) * 100) / 100;
  }

  // 安全マージン（盛り込み）適用後の必要設計成分値を返す
  function getRequiredDesignTarget(baseTarget) {
    const T = baseTarget || state.target;
    const apply = (val, isMicro) => {
      if (!val || val <= 0) return 0;
      if (state.overageMode === "plus_02") return round2(val + (isMicro ? Math.min(0.05, val * 0.1) : 0.2));
      if (state.overageMode === "plus_03") return round2(val + (isMicro ? Math.min(0.08, val * 0.15) : 0.3));
      if (state.overageMode === "mult_103") return round2(val * 1.03);
      return val;
    };
    const out = {};
    ALL_NUTRIENT_KEYS.forEach((k) => {
      const isExtra = !["N", "P", "K", "Mg"].includes(k);
      if (isExtra && !state.enabledExtras.includes(k) && !baseTarget) {
        out[k] = 0;
      } else {
        const isMicro = ["Mn", "B", "Fe", "Zn", "Cu", "Mo"].includes(k);
        out[k] = apply(T[k] || 0, isMicro);
      }
    });
    return out;
  }

  // ==================== 連立逆算ソルバー（指定原料＋追加副成分・微量要素を解く） ====================
  function solveFormulation(reqTarget, config) {
    const nMat = getMaterial(config.nId);
    const pMat = getMaterial(config.pId);
    const kMat = getMaterial(config.kId);
    const mgMat = config.mgId ? getMaterial(config.mgId) : null;

    if (!nMat || !pMat || !kMat) {
      return { feasible: false, totalRatio: 0, items: [], errorReason: "原料が選択されていません" };
    }

    const items = [];
    const supplied = {};
    ALL_NUTRIENT_KEYS.forEach((k) => (supplied[k] = 0));

    const addItemAmount = (mat, ratio) => {
      if (!mat || ratio <= 0) return;
      const r = round2(ratio);
      const existing = items.find((x) => x.id === mat.id);
      if (existing) {
        existing.ratio = round2(existing.ratio + r);
      } else {
        items.push({ id: mat.id, ratio: r });
      }
      ALL_NUTRIENT_KEYS.forEach((k) => {
        supplied[k] += (ratio * (mat[k] || 0)) / 100;
      });
    };

    // 1. 固定有機枠がある場合は先に計上
    if (config.organicId && config.organicRatio > 0) {
      const orgMat = getMaterial(config.organicId);
      if (orgMat) {
        addItemAmount(orgMat, config.organicRatio);
      }
    }

    // 2. カリ源 (K) の必要量を算出
    const remK = Math.max(0, (reqTarget.K || 0) - supplied.K);
    if (remK > 0) {
      if (kMat.K <= 0) {
        return { feasible: false, totalRatio: 999, items: [], errorReason: "カリ源にK成分が含まれていません" };
      }
      addItemAmount(kMat, (remK / kMat.K) * 100);
    }

    // 3. リン酸源 (P) の必要量を算出
    const remP = Math.max(0, (reqTarget.P || 0) - supplied.P);
    if (remP > 0) {
      if (pMat.P <= 0) {
        return { feasible: false, totalRatio: 999, items: [], errorReason: "リン酸源にP成分が含まれていません" };
      }
      addItemAmount(pMat, (remP / pMat.P) * 100);
    }

    // 随伴N超過チェック
    let overNWarning = null;
    if (supplied.N > (reqTarget.N || 0) + 0.35) {
      overNWarning = `リン酸源（${pMat.name}等）に付随する窒素だけで N ${round1(supplied.N)}% となり、目標N (${reqTarget.N}%) を超過します（MAPや重過石への変更を推奨）。`;
    }

    // 4. 窒素源 (N) の必要量を算出
    const remN = Math.max(0, (reqTarget.N || 0) - supplied.N);
    if (remN > 0) {
      if (nMat.N <= 0) {
        return { feasible: false, totalRatio: 999, items: [], errorReason: "窒素源にN成分が含まれていません" };
      }
      addItemAmount(nMat, (remN / nMat.N) * 100);
    }

    // 5. 苦土源 (Mg) の必要量を算出
    const remMg = Math.max(0, (reqTarget.Mg || 0) - supplied.Mg);
    if (remMg > 0 && mgMat && mgMat.Mg > 0) {
      addItemAmount(mgMat, (remMg / mgMat.Mg) * 100);
    }

    // 6. 追加指定された副成分・微量要素 (Si, Ca, Mn, B, Fe, Zn, Cu, Mo, S) の自動補填
    // Si(ケイカル等)はCaやFe/Mnも含むため、Si → Mn/B/Fe/Zn/Cu/Mo → Ca → S の順で補填する
    const extraOrder = ["Si", "Mn", "B", "Fe", "Zn", "Cu", "Mo", "Ca", "S"];
    extraOrder.forEach((key) => {
      const targetVal = reqTarget[key] || 0;
      if (targetVal <= 0) return;
      const rem = Math.max(0, targetVal - (supplied[key] || 0));
      if (rem <= 0.005) return;

      const def = EXTRA_NUTRIENT_DEFS.find((d) => d.key === key);
      if (!def) return;
      const srcMat = getMaterial(def.sourceId);
      if (srcMat && (srcMat[key] || 0) > 0) {
        addItemAmount(srcMat, (rem / srcMat[key]) * 100);
      }
    });

    const totalRatio = round2(items.reduce((acc, it) => acc + it.ratio, 0));
    const feasible = totalRatio <= 100.0 && !overNWarning;

    return {
      feasible,
      totalRatio,
      items,
      overNWarning
    };
  }

  // ==================== 配合禁忌＆製造リスク検証エンジン ====================
  function evaluateCompatibilityAndRisks(activeItems) {
    const alerts = [];
    const mats = activeItems
      .filter((it) => it.ratio > 0)
      .map((it) => ({ ...getMaterial(it.id), ratio: it.ratio }));

    if (mats.length === 0) return alerts;

    for (let i = 0; i < mats.length; i++) {
      for (let j = i + 1; j < mats.length; j++) {
        const A = mats[i];
        const B = mats[j];
        const aForbidsB = Array.isArray(A.forbiddenWith) && A.forbiddenWith.includes(B.id);
        const bForbidsA = Array.isArray(B.forbiddenWith) && B.forbiddenWith.includes(A.id);
        if (aForbidsB || bForbidsA) {
          alerts.push({
            level: "danger",
            title: `❌ 配合禁忌ペア検出: 「${A.name}」×「${B.name}」`,
            detail:
              (A.id === "urea" || B.id === "urea") &&
              (A.flags.includes("has_free_acid") || B.flags.includes("has_free_acid"))
                ? "生尿素と過石・重過石を混合すると、遊離酸・結晶水と反応して付着水が遊離し、著しく泥状化（ベタつき・固化）するため製造不可です。リン酸源を「DAP / MAP」に変えるか、窒素源を「硫安 / 被覆尿素」に変更してください。"
                : "直接配合禁忌（混合不可）に設定されている原料同士が処方に含まれています（吸湿液化・成分損失の原因）。"
          });
        }
      }
    }

    const anMats = mats.filter((m) => m.flags && m.flags.includes("has_an"));
    const wpMats = mats.filter((m) => m.flags && m.flags.includes("has_wp"));
    const freeAcidMats = mats.filter((m) => m.flags && m.flags.includes("has_free_acid"));
    const unMats = mats.filter((m) => m.flags && m.flags.includes("has_un") && m.id !== "coated_urea_lp");
    const strongAlkaliMats = mats.filter(
      (m) => m.flags && (m.flags.includes("is_strong_alkali") || m.flags.includes("has_cyanamide"))
    );
    const weakAlkaliMats = mats.filter((m) => m.flags && m.flags.includes("is_weak_alkali"));

    if (anMats.length > 0 && strongAlkaliMats.length > 0) {
      alerts.push({
        level: "danger",
        title: `❌ 化学反応禁忌（アンモニア揮散）: アンモニア態N × 強アルカリ資材`,
        detail: `「${anMats.map((m) => m.name).join("・")}」と「${strongAlkaliMats.map((m) => m.name).join("・")}」を混合すると、アルカリ反応によりアンモニアガスが発生し、窒素成分の損失および袋膨張・固結を引き起こします。`
      });
    }

    if (wpMats.length > 0 && strongAlkaliMats.length > 0) {
      alerts.push({
        level: "danger",
        title: `❌ 化学反応禁忌（水溶性リン酸の退行）: 水溶性P × 強アルカリ資材`,
        detail: `「${wpMats.map((m) => m.name).join("・")}」の水溶性リン酸が「${strongAlkaliMats.map((m) => m.name).join("・")}」と反応し、難溶性リン酸へ退行（不溶化）して保証成分割れを起こします。`
      });
    }

    if (unMats.length > 0 && freeAcidMats.length > 0 && !alerts.some((a) => a.title.includes("配合禁忌ペア検出"))) {
      alerts.push({
        level: "danger",
        title: `❌ 泥状化禁忌: 尿素態N × 遊離酸・結晶水含有原料`,
        detail: `「${unMats.map((m) => m.name).join("・")}」と「${freeAcidMats.map((m) => m.name).join("・")}」の混合は結晶水遊離による泥状化を起こします。`
      });
    }

    if ((anMats.length > 0 || wpMats.length > 0) && weakAlkaliMats.length > 0) {
      const weakAlkaliSum = weakAlkaliMats.reduce((s, m) => s + m.ratio, 0);
      if (weakAlkaliSum >= 12) {
        alerts.push({
          level: "warning",
          title: `⚠️ 塩基性資材の配合率注意（計 ${round1(weakAlkaliSum)}%）`,
          detail: `アンモニア態Nや水溶性Pを含む原料に対し、塩基性の「${weakAlkaliMats.map((m) => m.name).join("・")}」が ${round1(weakAlkaliSum)}% 配合されています。長期保管時のアンモニア臭発生や水溶性リン酸の退行を防ぐため、中性増量材（クレー・石膏・ゼオライト）や硫酸マグネシウムへの置換も検討してください。`
        });
      }
    }

    const clMats = mats.filter((m) => m.flags && m.flags.includes("has_chlorine"));
    if (state.requireChlorineFree && clMats.length > 0) {
      alerts.push({
        level: "danger",
        title: `❌ 塩素（Cl）混入エラー（塩素フリー制約違反）`,
        detail: `「塩素フリー（硫酸系）」が指定されていますが、塩素を含む「${clMats.map((m) => m.name).join("・")}」が使用されています。硫酸カリや硫安・尿素へ変更してください。`
      });
    }

    const hygroMats = mats.filter((m) => m.flags && m.flags.includes("is_hygroscopic"));
    const hygroSum = hygroMats.reduce((s, m) => s + m.ratio, 0);
    if (hygroSum >= 35) {
      alerts.push({
        level: "info",
        title: `💧 吸湿・固結対策推奨（吸湿性原料 計 ${round1(hygroSum)}%）`,
        detail: `尿素等の吸湿性が高い原料が35%以上配合されています。BB肥料の場合は固結防止材（ケイソウ土・ゼオライト微粉コーティング等）および防湿内袋の使用を推奨します。`
      });
    }

    const powderMats = mats.filter((m) => m.flags && m.flags.includes("is_powder"));
    if (powderMats.length > 0) {
      alerts.push({
        level: "warning",
        title: `⚠️ 粉状原料の分級（偏析）注意`,
        detail: `粉状フラグのある「${powderMats.map((m) => m.name).join("・")}」が含まれています。粒状BB肥料として袋詰めすると輸送中に粒と粉が分離（分級）するため、粒状成型品を使用するか化成造粒処方としてください。`
      });
    }

    return alerts;
  }

  // ==================== UI レンダリング ====================
  function renderAuthHeader() {
    const badge = document.getElementById("role-status-badge");
    const btn = document.getElementById("btn-toggle-auth");
    const notice = document.getElementById("admin-notice-bar");

    if (state.isAdmin) {
      badge.className = "role-badge admin-mode";
      badge.textContent = "🔑 管理者モード（マスター原料の追加・編集・削除・保存が可能）";
      btn.textContent = "🔓 管理者ログアウト";
      if (notice) {
        notice.className = "admin-notice-bar unlocked";
        notice.innerHTML = `
          <div><strong>🔑 管理者モードでログイン中：</strong> 追加・編集した原料は共通マスターデータベースへ保存され、<code>materials.js</code> として書き出し可能です。</div>
        `;
      }
    } else {
      badge.className = "role-badge user-mode";
      badge.textContent = "👤 一般利用者モード（マスター閲覧・処方試算）";
      btn.textContent = "🔒 管理者ログイン";
      if (notice) {
        notice.className = "admin-notice-bar locked";
        notice.innerHTML = `
          <div><strong>🔒 現在「一般利用者モード」です：</strong> 既存のマスター原料の書き換え・削除は保護されています（この画面で追加した原料は一時試算用としてのみ動作します）。サーバー/マスターの一覧を更新する場合は右上の「管理者ログイン」を行ってください。</div>
        `;
      }
    }
  }

  function renderExtraNutrientSelector() {
    const togglesRow = document.getElementById("extra-nutrient-toggles");
    const targetsGrid = document.getElementById("extra-targets-grid");
    if (!togglesRow || !targetsGrid) return;

    togglesRow.innerHTML = EXTRA_NUTRIENT_DEFS.map((d) => {
      const checked = state.enabledExtras.includes(d.key);
      return `
        <label class="extra-toggle-chip ${checked ? "active" : ""}">
          <input type="checkbox" data-extra-toggle="${d.key}" ${checked ? "checked" : ""} />
          <span>${d.label}</span>
        </label>
      `;
    }).join("");

    const activeDefs = EXTRA_NUTRIENT_DEFS.filter((d) => state.enabledExtras.includes(d.key));
    targetsGrid.innerHTML = activeDefs
      .map(
        (d) => `
        <div class="grade-input-box extra-theme">
          <label for="target-${d.key}">${d.label}</label>
          <div class="unit-input">
            <input
              type="number"
              id="target-${d.key}"
              data-extra-input="${d.key}"
              value="${state.target[d.key] || 0}"
              min="0"
              max="80"
              step="${d.step}"
            />
            <span>%</span>
          </div>
        </div>
      `
      )
      .join("");
  }

  function initDropdowns() {
    const presetSel = document.getElementById("preset-grade-select");
    presetSel.innerHTML =
      `<option value="">-- プリセット銘柄を選択 --</option>` +
      window.MASTER_FERTILIZER_DB.gradePresets
        .map((p) => `<option value="${p.id}">${p.name}</option>`)
        .join("");

    const catFilter = document.getElementById("recipe-category-filter");
    catFilter.innerHTML =
      `<option value="all">すべての原料区分</option>` +
      window.MASTER_FERTILIZER_DB.categories
        .map((c) => `<option value="${c.id}">${c.name}</option>`)
        .join("");

    const matCat = document.getElementById("mat-category");
    matCat.innerHTML = window.MASTER_FERTILIZER_DB.categories
      .map((c) => `<option value="${c.id}">${c.name}</option>`)
      .join("");

    updateRecipeMaterialSelect();
    renderFlagCheckboxesForm();
  }

  function updateRecipeMaterialSelect() {
    const sel = document.getElementById("recipe-material-select");
    const list = window.MASTER_FERTILIZER_DB.materials.filter(
      (m) => state.recipeCategoryFilter === "all" || m.category === state.recipeCategoryFilter
    );
    sel.innerHTML = list
      .map((m) => {
        const spec = [];
        ALL_NUTRIENT_KEYS.forEach((k) => {
          if ((m[k] || 0) > 0) spec.push(`${k}:${m[k]}%`);
        });
        if (spec.length === 0) spec.push("増量材/0%");
        return `<option value="${m.id}">${m.name} [${spec.join(" / ")}]</option>`;
      })
      .join("");
  }

  function renderFormulatorTab() {
    const reqTarget = getRequiredDesignTarget();
    const tbody = document.getElementById("recipe-table-body");

    if (state.recipe.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">
            原料が処方されていません。上の「⚡ この原料構成で目標銘柄を逆算」または「＋ 処方表へ追加」から原料を投入してください。
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = state.recipe
        .map((item, idx) => {
          const mat = getMaterial(item.id);
          if (!mat) return "";
          const r = item.ratio;
          const kgPerTon = round1(r * 10);
          const kgPerBag = round2((r * 20) / 100);

          // 原料が含有している成分一覧と供給量ラベル
          const matSpecs = [];
          const suppliedParts = [];
          const fitBtns = [];

          ALL_NUTRIENT_KEYS.forEach((k) => {
            const contentPct = mat[k] || 0;
            if (contentPct > 0) {
              matSpecs.push(`${k} ${contentPct}%`);
              const supVal = round2((r * contentPct) / 100);
              suppliedParts.push(`${k}:<b>${supVal}</b>`);
              // 基本4成分、または現在有効化されている追加成分の「〇〇合わせ」ボタンを表示
              if (["N", "P", "K", "Mg"].includes(k) || state.enabledExtras.includes(k)) {
                fitBtns.push(`<button type="button" class="btn-fit-mini" data-idx="${idx}" data-fit="${k}">${k}合わせ</button>`);
              }
            }
          });

          if (mat.flags && mat.flags.includes("is_filler")) {
            fitBtns.push(`<button type="button" class="btn-fit-mini" data-idx="${idx}" data-fit="FILLER">100%残余充填</button>`);
          }

          return `
            <tr>
              <td>
                <strong>${mat.name}</strong>
                <div style="font-size:0.74rem;color:var(--text-muted);">
                  含有: ${matSpecs.length > 0 ? matSpecs.join(" / ") : "不活性フィラー (0%)"}
                </div>
              </td>
              <td>
                <div class="ratio-input-wrap">
                  <input type="number" class="ratio-num-input" data-idx="${idx}" value="${round2(r)}" min="0" max="150" step="0.2" />
                  <span>%</span>
                </div>
              </td>
              <td><strong>${kgPerTon}</strong> kg</td>
              <td>${kgPerBag} kg</td>
              <td>
                <span style="font-family:monospace;font-size:0.81rem;">
                  ${suppliedParts.length > 0 ? suppliedParts.join(" / ") : "-"}
                </span>
              </td>
              <td><div class="fit-mini-btns">${fitBtns.join("")}</div></td>
              <td><button type="button" class="btn-del-row" data-del="${idx}" title="削除">✕</button></td>
            </tr>
          `;
        })
        .join("");
    }

    // 集計計算
    const totals = {
      ratio: 0,
      fillerRatio: 0,
      activeRatio: 0,
      N: 0, AN: 0, UN: 0, NN: 0, ON: 0,
      P: 0, WP: 0, CP: 0,
      K: 0, Mg: 0, Ca: 0, Si: 0, S: 0, Mn: 0, B: 0, Fe: 0, Zn: 0, Cu: 0, Mo: 0,
      costPerTon: 0,
      organicWeightRatio: 0,
      hasChlorine: false
    };

    state.recipe.forEach((item) => {
      const mat = getMaterial(item.id);
      if (!mat || item.ratio <= 0) return;
      const r = item.ratio;
      totals.ratio += r;

      const isPureFiller =
        mat.flags &&
        mat.flags.includes("is_filler") &&
        mat.N === 0 &&
        mat.P === 0 &&
        mat.K === 0 &&
        (!state.enabledExtras.includes("Ca") || (mat.Ca || 0) === 0);

      if (isPureFiller) {
        totals.fillerRatio += r;
      } else {
        totals.activeRatio += r;
      }

      const nVal = (r * (mat.N || 0)) / 100;
      const anVal = (r * (mat.AN || 0)) / 100;
      const unVal = (r * (mat.UN || 0)) / 100;
      const nnVal = (r * (mat.NN || 0)) / 100;
      totals.N += nVal;
      totals.AN += anVal;
      totals.UN += unVal;
      totals.NN += nnVal;
      if (mat.flags && mat.flags.includes("is_organic")) {
        totals.ON += Math.max(0, nVal - anVal - unVal - nnVal);
        totals.organicWeightRatio += r;
      }

      totals.P += (r * (mat.P || 0)) / 100;
      totals.WP += (r * (mat.WP || 0)) / 100;
      totals.CP += (r * (mat.CP || mat.P || 0)) / 100;

      ["K", "Mg", "Ca", "Si", "S", "Mn", "B", "Fe", "Zn", "Cu", "Mo"].forEach((k) => {
        totals[k] += (r * (mat[k] || 0)) / 100;
      });

      totals.costPerTon += (r / 100) * (mat.pricePerTon || 0);
      if (mat.flags && mat.flags.includes("has_chlorine")) {
        totals.hasChlorine = true;
      }
    });

    totals.ratio = round2(totals.ratio);

    // 100% 成立可否バナーの描画
    const banner = document.getElementById("feasibility-banner");
    const totalRatioText = document.getElementById("total-ratio-text");
    const totalKgText = document.getElementById("total-kg-text");
    const fillerMarginText = document.getElementById("filler-margin-text");

    totalRatioText.textContent = `${totals.ratio.toFixed(1)}%`;
    totalKgText.textContent = Math.round(totals.ratio * 10).toLocaleString();

    if (totals.ratio > 100.05) {
      const overPct = round1(totals.ratio - 100);
      const overKg = Math.round((totals.ratio - 100) * 10);
      const scaleTo100 = 100 / totals.ratio;
      const maxN = (totals.N * scaleTo100).toFixed(1);
      const maxP = (totals.P * scaleTo100).toFixed(1);
      const maxK = (totals.K * scaleTo100).toFixed(1);

      banner.className = "feasibility-banner impossible";
      banner.innerHTML = `
        <h3>🔴 製造不可（重量合計が 100% を超過しています：計 ${totals.ratio.toFixed(1)}%）</h3>
        <p>
          目標成分を満たすために必要な原料重量が <strong>1,000kg に対して +${overKg}kg (+${overPct}%) オーバー</strong>しており、物理的に1袋(100%)に収まりません。<br/>
          💡 <strong>この原料構成での製造可能上限は「N ${maxN} - P ${maxP} - K ${maxK}」まで</strong>です。これ以上の高成分を作るには、より高濃度な原料（硫安→尿素、過石→重過石/MAP/DAP、硫加→塩加など）へ切り替えてください。
        </p>
      `;
      fillerMarginText.className = "margin-pill over";
      fillerMarginText.textContent = `超過: +${overPct}% (+${overKg}kg/t)`;
    } else if (totals.ratio >= 96.0 && totals.fillerRatio < 1.0) {
      const remPct = round1(100 - totals.ratio);
      banner.className = "feasibility-banner tight";
      banner.innerHTML = `
        <h3>🟡 製造可能（限界ギリギリ領域：有効原料計 ${totals.ratio.toFixed(1)}%）</h3>
        <p>
          100%枠内に収まっていますが、増量材・固結防止材や水分公差を入れる余地が <strong>残り ${remPct}% (${Math.round(remPct * 10)}kg/t)</strong> しかありません。この原料構成におけるほぼ最高限界グレードです。
        </p>
      `;
      fillerMarginText.className = "margin-pill ok";
      fillerMarginText.textContent = `空き枠: ${remPct}%`;
    } else {
      const remPct = round1(100 - totals.ratio);
      banner.className = "feasibility-banner ok";
      banner.innerHTML = `
        <h3>🟢 製造可能（重量合計 ${totals.ratio.toFixed(1)}% ／ 有効原料 ${round1(totals.activeRatio)}% ＋ 増量材 ${round1(totals.fillerRatio)}%）</h3>
        <p>
          1,000kg（100%）の枠内で無理なく処方成立しています。${
            remPct > 0.1
              ? `残り <strong>${remPct}% (${Math.round(remPct * 10)}kg/t)</strong> の空き枠があります（「⚖️ 残余枠を増量材で100%に充填」で1,000kgピッタリに調整できます）。`
              : "重量合計 100.0%（1,000kg/t）に調整済みです。"
          }
        </p>
      `;
      fillerMarginText.className = "margin-pill ok";
      fillerMarginText.textContent = `空き枠: ${remPct}%`;
    }

    // 重量バーセグメント描画
    const barTrack = document.getElementById("weight-bar-segments");
    const maxScale = Math.max(100, totals.ratio);
    barTrack.innerHTML = state.recipe
      .filter((it) => it.ratio > 0)
      .map((it, idx) => {
        const mat = getMaterial(it.id);
        const widthPct = (it.ratio / maxScale) * 100;
        const isFiller = mat && mat.flags && mat.flags.includes("is_filler") && mat.N === 0 && mat.P === 0 && mat.K === 0;
        const bg = totals.ratio > 100.05 ? "#dc2626" : isFiller ? "#94a3b8" : SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
        return `<div class="w-seg" style="width:${widthPct}%;background:${bg}" title="${mat ? mat.name : ""}: ${it.ratio}%">${
          widthPct > 8 ? `${mat ? mat.name.slice(0, 6) : ""} ${round1(it.ratio)}%` : ""
        }</div>`;
      })
      .join("");

    // 配合禁忌・リスクアラート描画
    const alerts = evaluateCompatibilityAndRisks(state.recipe);
    const alertsBox = document.getElementById("compatibility-alerts");
    alertsBox.innerHTML = alerts
      .map(
        (a) => `
        <div class="alert-item ${a.level}">
          <strong>${a.title}</strong>
          <div>${a.detail}</div>
        </div>
      `
      )
      .join("");

    // 保証成分 vs 理論成分 比較テーブル（基本4成分 ＋ 選択された追加保証成分）
    const compRows = [
      {
        key: "N",
        label: "窒素全量 (T-N)",
        guar: state.target.N,
        req: reqTarget.N,
        actual: totals.N,
        detail: `A-N: ${round1(totals.AN)}% / U-N: ${round1(totals.UN)}% / N-N: ${round1(totals.NN)}% / 有機N: ${round1(totals.ON)}%`
      },
      {
        key: "P",
        label: "リン酸全量 (T-P₂O₅)",
        guar: state.target.P,
        req: reqTarget.P,
        actual: totals.P,
        detail: `水溶性(W-P): ${round1(totals.WP)}% / く溶性(C-P): ${round1(totals.CP)}%`
      },
      {
        key: "K",
        label: "カリ (K₂O)",
        guar: state.target.K,
        req: reqTarget.K,
        actual: totals.K,
        detail: `水溶性・く溶性カリ計`
      },
      {
        key: "Mg",
        label: "苦土 (MgO)",
        guar: state.target.Mg,
        req: reqTarget.Mg,
        actual: totals.Mg,
        detail: totals.Mg > 0 ? "苦土含有" : "-"
      }
    ];

    // 追加指定された副成分・微量要素（または処方中に含まれている副成分）を行として追加
    EXTRA_NUTRIENT_DEFS.forEach((d) => {
      const isEnabled = state.enabledExtras.includes(d.key);
      const actualVal = totals[d.key] || 0;
      if (isEnabled || actualVal > 0.001) {
        compRows.push({
          key: d.key,
          label: `${d.label}${isEnabled ? " [指定]" : " (副成分)"}`,
          guar: isEnabled ? state.target[d.key] || 0 : 0,
          req: isEnabled ? reqTarget[d.key] || 0 : 0,
          actual: actualVal,
          detail: isEnabled ? "保証対象として指定中" : "原料由来の随伴供給"
        });
      }
    });

    document.getElementById("comp-table-body").innerHTML = compRows
      .map((r) => {
        const isMicro = ["Mn", "B", "Fe", "Zn", "Cu", "Mo"].includes(r.key);
        const tol = isMicro ? -0.01 : -0.08;
        const diff = round2(r.actual - r.req);
        const pass = diff >= tol;
        const badge =
          r.guar === 0 && r.req === 0
            ? `<span style="color:var(--text-muted)">随伴含有</span>`
            : pass
            ? `<span class="diff-badge pass">合格 (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%)</span>`
            : `<span class="diff-badge short">不足 (${diff.toFixed(2)}%)</span>`;

        return `
          <tr>
            <td><strong>${r.label}</strong></td>
            <td>${r.guar > 0 ? `${r.guar}%` : "-"}</td>
            <td>${r.req > 0 ? `${r.req.toFixed(2)}%` : "-"}</td>
            <td><strong style="font-size:0.95rem;">${r.actual.toFixed(2)}%</strong></td>
            <td>${badge}</td>
            <td><small style="color:var(--text-muted)">${r.detail}</small></td>
          </tr>
        `;
      })
      .join("");

    // KPI サマリー
    document.getElementById("kpi-cost-ton").textContent = `¥${Math.round(totals.costPerTon).toLocaleString()} / t`;
    document.getElementById("kpi-cost-bag").textContent = `20kg袋あたり原料原価: ¥${Math.round(totals.costPerTon / 50).toLocaleString()}`;

    const orgNShare = totals.N > 0 ? Math.round((totals.ON / totals.N) * 100) : 0;
    document.getElementById("kpi-organic-ratio").textContent = `重量比 ${round1(totals.organicWeightRatio)}%`;
    document.getElementById("kpi-organic-n-share").textContent = `全窒素に占める有機態N割合: ${orgNShare}% (${round2(totals.ON)}%)`;

    const subs = [];
    EXTRA_NUTRIENT_DEFS.forEach((d) => {
      if ((totals[d.key] || 0) > 0.005) {
        subs.push(`${d.short}: ${round2(totals[d.key])}%`);
      }
    });
    document.getElementById("kpi-sub-nutrients").textContent = subs.length > 0 ? subs.join(" / ") : "なし";
    document.getElementById("kpi-chlorine-status").textContent = totals.hasChlorine
      ? "⚠️ 塩素(Cl)含有原料あり（塩加・塩安系）"
      : "✅ 塩素(Cl)フリー処方（硫酸系）";
  }

  // ==================== UI レンダリング (TAB 2: 成分限界検討マトリクス) ====================
  function renderBoundaryTab() {
    const patternStr = document.getElementById("limit-ratio-pattern").value;
    let rN = 1, rP = 1, rK = 1;
    if (patternStr === "current") {
      const minBase = Math.max(1, Math.min(state.target.N || 10, state.target.P || 10, state.target.K || 10));
      rN = (state.target.N || 10) / minBase;
      rP = (state.target.P || 10) / minBase;
      rK = (state.target.K || 10) / minBase;
    } else {
      const parts = patternStr.split(":").map(Number);
      rN = parts[0];
      rP = parts[1];
      rK = parts[2];
    }

    document.getElementById("limit-current-target-label").textContent = `(${state.target.N}-${state.target.P}-${state.target.K})`;

    const combos = [
      {
        title: "① 普通化成・低濃度硫酸系",
        desc: "硫安(21) ＋ 過石(17.5) ＋ 硫加(50)",
        config: { nId: "ammonium_sulfate", pId: "single_superphosphate", kId: "potassium_sulfate" },
        feature: "塩素フリー・Ca/S豊富だが、過石と硫安の濃度が低いため高成分は作れない（8-8-8付近が限界）"
      },
      {
        title: "② 普通化成・塩加系",
        desc: "硫安(21) ＋ 過石(17.5) ＋ 塩加(60)",
        config: { nId: "ammonium_sulfate", pId: "single_superphosphate", kId: "potassium_chloride" },
        feature: "市販8-8-8の基本構成。カリを塩加(60%)にすることで少しだけ上限が伸びる"
      },
      {
        title: "③ 中濃度・重過石＋硫安系",
        desc: "硫安(21) ＋ 重過石(35) ＋ 塩加(60)",
        config: { nId: "ammonium_sulfate", pId: "triple_superphosphate", kId: "potassium_chloride" },
        feature: "尿素を使わずにリン酸濃度を高めた構成（10-10-10〜12-12-12クラスまで対応）"
      },
      {
        title: "④ りん安(MAP)＋硫安・硫酸系",
        desc: "硫安(21) ＋ MAP(11-50) ＋ 硫加(50)",
        config: { nId: "ammonium_sulfate", pId: "map", kId: "potassium_sulfate" },
        feature: "尿素・塩素を使わない高品質な高度化成・BB処方（12-12-12〜14-14-14クラス）"
      },
      {
        title: "⑤ 高度BB・尿素＋MAP＋硫加（塩素フリー）",
        desc: "尿素(46) ＋ MAP(11-50) ＋ 硫加(50)",
        config: { nId: "urea", pId: "map", kId: "potassium_sulfate" },
        feature: "塩素フリーでありながら尿素とMAPにより高成分（17-17-17付近）まで製造可能"
      },
      {
        title: "⑥ 最高濃度BB・尿素＋DAP＋塩加",
        desc: "尿素(46) ＋ DAP(18-46) ＋ 塩加(60)",
        config: { nId: "urea", pId: "dap", kId: "potassium_chloride" },
        feature: "粒状BB肥料で到達できる最高峰の高成分構成（水平型は 19.3-19.3-19.3 が物理限界、20-20-20は100%超過）"
      },
      {
        title: "⑦ 苦土・ケイ酸入り（ようりん併用）",
        desc: "尿素(46) ＋ ようりん(20) ＋ 塩加(60)",
        config: { nId: "urea", pId: "fused_magnesium_phosphate", kId: "potassium_chloride" },
        feature: "リン酸源をすべてようりん(20%)にすると、P枠が重いため中成分（11-11-11付近）が上限となる"
      },
      {
        title: "⑧ 有機30%入り（菜種油かす30%固定）",
        desc: "菜種油かす30% ＋ 尿素 ＋ DAP ＋ 塩加",
        config: {
          nId: "urea",
          pId: "dap",
          kId: "potassium_chloride",
          organicId: "rapeseed_meal",
          organicRatio: 30
        },
        feature: "重量の30%を低成分な有機原料が占めるため、残り70%枠に高濃度原料を詰めても約 14.5-14.5-14.5 が上限"
      }
    ];

    const tbody = document.getElementById("limit-comparison-tbody");
    tbody.innerHTML = combos
      .map((c, idx) => {
        const findMaxMultiplier = (limitPct) => {
          let low = 0, high = 60;
          for (let iter = 0; iter < 28; iter++) {
            const mid = (low + high) / 2;
            const res = solveFormulation({ N: rN * mid, P: rP * mid, K: rK * mid, Mg: 0 }, c.config);
            if (res.feasible && res.totalRatio <= limitPct) {
              low = mid;
            } else {
              high = mid;
            }
          }
          return low;
        };

        const k100 = findMaxMultiplier(100.0);
        const k95 = findMaxMultiplier(95.0);

        const maxGradeStr = `${(rN * k100).toFixed(1)} - ${(rP * k100).toFixed(1)} - ${(rK * k100).toFixed(1)}`;
        const safeGradeStr = `${(rN * k95).toFixed(1)} - ${(rP * k95).toFixed(1)} - ${(rK * k95).toFixed(1)}`;

        const curRes = solveFormulation(getRequiredDesignTarget(), c.config);
        let curJudgeHtml = "";
        if (curRes.feasible) {
          curJudgeHtml = `<span class="diff-badge pass">🟢 製造可能 (計 ${curRes.totalRatio.toFixed(1)}%)</span>`;
        } else if (curRes.overNWarning) {
          curJudgeHtml = `<span class="diff-badge short">🔴 随伴N超過</span>`;
        } else {
          curJudgeHtml = `<span class="diff-badge short">🔴 不可 (計 ${curRes.totalRatio.toFixed(1)}%)</span>`;
        }

        return `
          <tr>
            <td><strong>${c.title}</strong></td>
            <td><small>${c.desc}</small></td>
            <td><span class="max-grade-pill">${maxGradeStr}</span></td>
            <td><span class="safe-grade-pill">${safeGradeStr}</span></td>
            <td>${curJudgeHtml}</td>
            <td><small style="color:var(--text-muted)">${c.feature}</small></td>
            <td>
              <button type="button" class="btn-outline btn-sm" data-apply-combo="${idx}">
                この構成で試算
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    window._cachedBoundaryCombos = combos;
    render2DFeasibilityMatrix();
  }

  function render2DFeasibilityMatrix() {
    const nId = document.getElementById("mat-n-src").value;
    const pId = document.getElementById("mat-p-src").value;
    const kId = document.getElementById("mat-k-src").value;
    const fixedK = parseFloat(document.getElementById("mat-fixed-k").value) || 0;
    const fixedMg = parseFloat(document.getElementById("mat-fixed-mg").value) || 0;
    const fixedOrg = parseFloat(document.getElementById("mat-fixed-org").value) || 0;

    const config = {
      nId,
      pId,
      kId,
      mgId: "magnesium_hydroxide",
      organicId: fixedOrg > 0 ? "rapeseed_meal" : null,
      organicRatio: fixedOrg
    };

    const nValues = [0, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26];
    const pValues = [0, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28];

    let html = `<table class="feasibility-matrix-table"><thead><tr><th>P₂O₅ \\ N</th>`;
    nValues.forEach((n) => {
      html += `<th>N ${n}%</th>`;
    });
    html += `</tr></thead><tbody>`;

    pValues.forEach((p) => {
      html += `<tr><th>P ${p}%</th>`;
      nValues.forEach((n) => {
        const res = solveFormulation({ N: n, P: p, K: fixedK, Mg: fixedMg }, config);
        let cls = "ng";
        let label = "";
        let tip = "";

        if (res.overNWarning) {
          cls = "ng";
          label = "随伴N超";
          tip = res.overNWarning;
        } else if (res.totalRatio <= 95.0) {
          cls = "ok";
          const rem = Math.round(100 - res.totalRatio);
          label = `🟢 残${rem}%`;
          tip = `【製造可能】${n}-${p}-${fixedK} → 必要原料計 ${res.totalRatio.toFixed(1)}% (増量材枠 ${rem}%)。クリックで処方表へ反映`;
        } else if (res.totalRatio <= 100.0) {
          cls = "tight";
          const rem = (100 - res.totalRatio).toFixed(1);
          label = `🟡 残${rem}%`;
          tip = `【限界領域】${n}-${p}-${fixedK} → 必要原料計 ${res.totalRatio.toFixed(1)}%。クリックで処方表へ反映`;
        } else {
          cls = "ng";
          label = `🔴 ${Math.round(res.totalRatio)}%`;
          tip = `【製造不可】${n}-${p}-${fixedK} → 必要原料計 ${res.totalRatio.toFixed(1)}% (100%を ${(res.totalRatio - 100).toFixed(1)}% 超過)`;
        }

        html += `<td class="m-cell ${cls}" data-mn="${n}" data-mp="${p}" title="${tip}">${label}</td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table>`;
    document.getElementById("feasibility-matrix-wrap").innerHTML = html;
  }

  // ==================== UI レンダリング (TAB 3: 原料マスター＆チェックボックス追加) ====================
  function renderFlagCheckboxesForm() {
    const groups = {};
    window.MASTER_FERTILIZER_DB.flagDefinitions.forEach((f) => {
      if (!groups[f.group]) groups[f.group] = [];
      groups[f.group].push(f);
    });

    const container = document.getElementById("flag-checkboxes-container");
    container.innerHTML = Object.keys(groups)
      .map(
        (gName) => `
        <div class="flag-group-box">
          <h4>📌 ${gName}</h4>
          ${groups[gName]
            .map(
              (f) => `
              <label class="flag-check-item">
                <input type="checkbox" name="mat-flag" value="${f.id}" />
                <div>
                  <strong>${f.label}</strong>
                  <small>${f.desc}</small>
                </div>
              </label>
            `
            )
            .join("")}
        </div>
      `
      )
      .join("");

    renderDirectForbiddenCheckboxes();
  }

  function renderDirectForbiddenCheckboxes(excludeId) {
    const container = document.getElementById("direct-forbidden-checkboxes");
    container.innerHTML = window.MASTER_FERTILIZER_DB.materials
      .filter((m) => m.id !== excludeId)
      .map(
        (m) => `
        <label class="forbid-check-label">
          <input type="checkbox" name="mat-forbid" value="${m.id}" />
          <span>${m.name}</span>
        </label>
      `
      )
      .join("");
  }

  function renderMasterListTable() {
    const tbody = document.getElementById("master-list-tbody");
    const q = state.masterSearch.trim().toLowerCase();

    const catMap = {};
    window.MASTER_FERTILIZER_DB.categories.forEach((c) => (catMap[c.id] = c.name));

    const flagMap = {};
    window.MASTER_FERTILIZER_DB.flagDefinitions.forEach((f) => (flagMap[f.id] = f.label));

    const list = window.MASTER_FERTILIZER_DB.materials.filter((m) => {
      if (!q) return true;
      return `${m.name} ${m.note || ""}`.toLowerCase().includes(q);
    });

    tbody.innerHTML = list
      .map((m) => {
        const flagsHtml = (m.flags || [])
          .map((fid) => {
            let cls = "";
            if (fid === "is_strong_alkali" || fid === "has_free_acid") cls = "danger";
            else if (fid === "is_weak_alkali" || fid === "is_hygroscopic") cls = "warn";
            else if (fid === "is_filler") cls = "filler";
            return `<span class="flag-chip ${cls}">${flagMap[fid] || fid}</span>`;
          })
          .join("");

        const directForbidNames = (m.forbiddenWith || [])
          .map((id) => {
            const target = getMaterial(id);
            return target ? target.name : id;
          })
          .join(", ");

        const subList = [];
        ["Ca", "Si", "S", "Mn", "B", "Fe", "Zn", "Cu", "Mo"].forEach((k) => {
          if ((m[k] || 0) > 0) subList.push(`${k}:${m[k]}%`);
        });

        const adminBtns = state.isAdmin
          ? `
            <button type="button" class="btn-outline btn-sm" data-edit-mat="${m.id}">編集</button>
            <button type="button" class="btn-secondary btn-sm" data-delete-mat="${m.id}">削除</button>
          `
          : `<span style="font-size:0.75rem;color:var(--text-muted)">🔒 管理者のみ編集可</span>`;

        return `
          <tr>
            <td><small>${catMap[m.category] || m.category}</small></td>
            <td>
              <strong>${m.name}</strong>
              ${m.isTempSession ? '<span class="flag-chip warn">一時試算用</span>' : ""}
              <div style="font-size:0.74rem;color:var(--text-muted);max-width:260px">${m.note || ""}</div>
            </td>
            <td><strong>${m.N || 0}%</strong><br/><small>${m.AN || 0} / ${m.UN || 0}</small></td>
            <td><strong>${m.P || 0}%</strong><br/><small>${m.WP || 0} / ${m.CP || 0}</small></td>
            <td><strong>${m.K || 0}%</strong></td>
            <td>${m.Mg || 0}%</td>
            <td><small>${subList.length > 0 ? subList.join(", ") : "-"}</small></td>
            <td>
              ${flagsHtml || "-"}
              ${directForbidNames ? `<div style="font-size:0.72rem;color:var(--danger);margin-top:2px;">❌ 直接禁忌: ${directForbidNames}</div>` : ""}
            </td>
            <td>¥${(m.pricePerTon || 0).toLocaleString()}</td>
            <td>
              <div class="btn-row">
                <button type="button" class="btn-primary btn-sm" data-use-mat="${m.id}">＋ 処方へ</button>
                ${adminBtns}
              </div>
            </td>
          </tr>
        `;
      })
      .join("");
  }

  function renderAll() {
    renderAuthHeader();
    renderExtraNutrientSelector();
    updateRecipeMaterialSelect();
    renderFormulatorTab();
    renderBoundaryTab();
    renderMasterListTable();
  }

  // ==================== アクション・ヘルパー関数 ====================
  function runSolverFromUI() {
    const orgOpt = document.getElementById("solver-organic-opt").value;
    let organicId = null, organicRatio = 0;
    if (orgOpt === "rapeseed_20") { organicId = "rapeseed_meal"; organicRatio = 20; }
    else if (orgOpt === "rapeseed_40") { organicId = "rapeseed_meal"; organicRatio = 40; }
    else if (orgOpt === "fish_20") { organicId = "fish_meal"; organicRatio = 20; }
    else if (orgOpt === "feather_20") { organicId = "feather_meal"; organicRatio = 20; }

    const config = {
      nId: document.getElementById("solver-n-source").value,
      pId: document.getElementById("solver-p-source").value,
      kId: document.getElementById("solver-k-source").value,
      mgId: document.getElementById("solver-mg-source").value,
      organicId,
      organicRatio
    };

    const reqTarget = getRequiredDesignTarget();
    const res = solveFormulation(reqTarget, config);
    state.recipe = res.items;
    renderAll();
  }

  function fillRemainingWithFiller() {
    const currentSum = state.recipe.reduce((s, it) => s + it.ratio, 0);
    if (currentSum >= 100) return;
    const rem = round2(100 - currentSum);
    const existingFiller = state.recipe.find((it) => {
      const m = getMaterial(it.id);
      return m && m.flags && m.flags.includes("is_filler") && m.N === 0 && m.P === 0 && m.K === 0;
    });
    if (existingFiller) {
      existingFiller.ratio = round2(existingFiller.ratio + rem);
    } else {
      state.recipe.push({ id: "filler_clay", ratio: rem });
    }
    renderAll();
  }

  function fitRowToNutrient(idx, key) {
    const item = state.recipe[idx];
    if (!item) return;
    const mat = getMaterial(item.id);
    if (!mat) return;

    if (key === "FILLER") {
      const otherRatio = state.recipe.reduce((s, it, i) => (i === idx ? s : s + it.ratio), 0);
      item.ratio = Math.max(0, round2(100 - otherRatio));
      renderAll();
      return;
    }

    const reqTarget = getRequiredDesignTarget();
    const otherSupplied = state.recipe.reduce((s, it, i) => {
      if (i === idx) return s;
      const m = getMaterial(it.id);
      return m ? s + (it.ratio * (m[key] || 0)) / 100 : s;
    }, 0);

    const needed = Math.max(0, (reqTarget[key] || state.target[key] || 0) - otherSupplied);
    if ((mat[key] || 0) > 0) {
      item.ratio = round2((needed / mat[key]) * 100);
      renderAll();
    }
  }

  function exportFormulationCsv() {
    const activeExtraKeys = EXTRA_NUTRIENT_DEFS.filter((d) => state.enabledExtras.includes(d.key)).map((d) => d.key);
    const headerNutrients = ["N", "P", "K", "Mg", ...activeExtraKeys];

    const rows = [
      ["化成肥料・BB肥料 処方設計書 (1,000kg / 100%基準)"],
      [
        "目標銘柄",
        headerNutrients.map((k) => `${k}:${state.target[k] || 0}%`).join(" - ")
      ],
      [],
      [
        "原料名",
        "配合率(%)",
        "1トンあたり重量(kg)",
        "20kg袋あたり重量(kg)",
        ...headerNutrients.map((k) => `${k}供給(%)`),
        "原料費(円/t)"
      ]
    ];

    let sumRatio = 0, sumCost = 0;
    const sumNut = {};
    headerNutrients.forEach((k) => (sumNut[k] = 0));

    state.recipe.forEach((it) => {
      const mat = getMaterial(it.id);
      if (!mat || it.ratio <= 0) return;
      const r = it.ratio;
      const cost = (r / 100) * (mat.pricePerTon || 0);
      sumRatio += r;
      sumCost += cost;

      const nutCells = headerNutrients.map((k) => {
        const val = (r * (mat[k] || 0)) / 100;
        sumNut[k] += val;
        return val.toFixed(2);
      });

      rows.push([
        mat.name,
        r.toFixed(2),
        (r * 10).toFixed(1),
        ((r * 20) / 100).toFixed(2),
        ...nutCells,
        Math.round(cost)
      ]);
    });

    rows.push([
      "合計",
      sumRatio.toFixed(2),
      (sumRatio * 10).toFixed(1),
      ((sumRatio * 20) / 100).toFixed(2),
      ...headerNutrients.map((k) => sumNut[k].toFixed(2)),
      Math.round(sumCost)
    ]);

    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `肥料処方設計書_${state.target.N}-${state.target.P}-${state.target.K}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportMasterJsFile() {
    if (!state.isAdmin) {
      alert("マスターデータの書き出しには管理者ログインが必要です。");
      return;
    }
    const content = `window.MASTER_FERTILIZER_DB = ${JSON.stringify(window.MASTER_FERTILIZER_DB, null, 2)};\n`;
    const blob = new Blob([content], { type: "application/javascript;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "materials.js";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ==================== イベントバインディング ====================
  function bindEvents() {
    // アプリ全体のパスワードロック画面制御 (pass: miyazawakenji)
    const lockScreen = document.getElementById("app-lock-screen");
    const unlockForm = document.getElementById("app-unlock-form");
    const gatePwInput = document.getElementById("app-gate-password");
    const gateError = document.getElementById("app-gate-error");

    if (lockScreen) {
      if (sessionStorage.getItem(STORAGE_APP_GATE_KEY) === "true") {
        lockScreen.classList.add("hidden");
        document.body.classList.remove("app-locked");
      } else {
        document.body.classList.add("app-locked");
      }

      unlockForm.addEventListener("submit", (e) => {
        e.preventDefault();
        if (gatePwInput.value === APP_GATE_PASSCODE) {
          sessionStorage.setItem(STORAGE_APP_GATE_KEY, "true");
          lockScreen.classList.add("hidden");
          document.body.classList.remove("app-locked");
          gateError.classList.add("hidden");
        } else {
          gateError.classList.remove("hidden");
          gatePwInput.select();
        }
      });
    }

    // タブ切り替え
    document.querySelectorAll(".nav-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".nav-tab").forEach((t) => {
          t.classList.remove("active");
          t.setAttribute("aria-selected", "false");
        });
        document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        tab.classList.add("active");
        tab.setAttribute("aria-selected", "true");
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add("active");
      });
    });

    // 管理者ログイン・ログアウト
    const authModal = document.getElementById("admin-login-modal");
    document.getElementById("btn-toggle-auth").addEventListener("click", () => {
      if (state.isAdmin) {
        state.isAdmin = false;
        sessionStorage.removeItem(STORAGE_ADMIN_TOKEN);
        renderAll();
      } else {
        document.getElementById("auth-error-msg").classList.add("hidden");
        document.getElementById("admin-password-input").value = "";
        authModal.classList.remove("hidden");
      }
    });

    document.getElementById("btn-close-auth-modal").addEventListener("click", () => authModal.classList.add("hidden"));
    document.getElementById("btn-cancel-auth").addEventListener("click", () => authModal.classList.add("hidden"));

    document.getElementById("admin-login-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const pw = document.getElementById("admin-password-input").value;
      if (pw === ADMIN_PASSCODE || pw === APP_GATE_PASSCODE) {
        state.isAdmin = true;
        sessionStorage.setItem(STORAGE_ADMIN_TOKEN, "true");
        authModal.classList.add("hidden");
        renderAll();
      } else {
        document.getElementById("auth-error-msg").classList.remove("hidden");
      }
    });

    // プリセット銘柄選択
    document.getElementById("preset-grade-select").addEventListener("change", (e) => {
      const p = window.MASTER_FERTILIZER_DB.gradePresets.find((x) => x.id === e.target.value);
      if (!p) return;
      state.target = { ...state.target, ...p.target };
      state.enabledExtras = Array.isArray(p.enabledExtras) ? [...p.enabledExtras] : [];
      document.getElementById("target-N").value = state.target.N;
      document.getElementById("target-P").value = state.target.P;
      document.getElementById("target-K").value = state.target.K;
      document.getElementById("target-Mg").value = state.target.Mg;
      state.recipe = p.recipe.map((r) => ({ ...r }));
      renderAll();
    });

    // 基本4目標成分入力
    ["N", "P", "K", "Mg"].forEach((k) => {
      document.getElementById(`target-${k}`).addEventListener("input", (e) => {
        state.target[k] = Math.max(0, parseFloat(e.target.value) || 0);
        renderFormulatorTab();
        renderBoundaryTab();
      });
    });

    // 追加保証成分（Ca, Si, S, Mn, B, Fe, Zn, Cu, Mo）のトグルと数値入力
    document.getElementById("extra-nutrient-toggles").addEventListener("change", (e) => {
      const key = e.target.dataset.extraToggle;
      if (!key) return;
      if (e.target.checked) {
        if (!state.enabledExtras.includes(key)) state.enabledExtras.push(key);
        const def = EXTRA_NUTRIENT_DEFS.find((d) => d.key === key);
        if (!state.target[key] || state.target[key] <= 0) {
          state.target[key] = def ? def.defaultTarget : 0.5;
        }
      } else {
        state.enabledExtras = state.enabledExtras.filter((k) => k !== key);
        state.target[key] = 0;
      }
      renderAll();
    });

    document.getElementById("extra-targets-grid").addEventListener("input", (e) => {
      const key = e.target.dataset.extraInput;
      if (!key) return;
      state.target[key] = Math.max(0, parseFloat(e.target.value) || 0);
      renderFormulatorTab();
    });

    document.getElementById("overage-select").addEventListener("change", (e) => {
      state.overageMode = e.target.value;
      renderAll();
    });

    document.getElementById("require-chlorine-free").addEventListener("change", (e) => {
      state.requireChlorineFree = e.target.checked;
      renderAll();
    });

    document.getElementById("btn-run-solver").addEventListener("click", runSolverFromUI);
    document.getElementById("btn-fill-filler").addEventListener("click", fillRemainingWithFiller);
    document.getElementById("btn-clear-recipe").addEventListener("click", () => {
      state.recipe = [];
      renderAll();
    });

    document.getElementById("recipe-category-filter").addEventListener("change", (e) => {
      state.recipeCategoryFilter = e.target.value;
      updateRecipeMaterialSelect();
    });

    document.getElementById("btn-add-to-recipe").addEventListener("click", () => {
      const id = document.getElementById("recipe-material-select").value;
      if (!id) return;
      const existing = state.recipe.find((it) => it.id === id);
      if (existing) {
        existing.ratio = round2(existing.ratio + 2);
      } else {
        const mat = getMaterial(id);
        const defaultRatio = mat && mat.category === "micronutrient" ? 1.5 : 10.0;
        state.recipe.push({ id, ratio: defaultRatio });
      }
      renderAll();
    });

    const recipeTbody = document.getElementById("recipe-table-body");
    recipeTbody.addEventListener("input", (e) => {
      if (e.target.classList.contains("ratio-num-input")) {
        const idx = parseInt(e.target.dataset.idx, 10);
        state.recipe[idx].ratio = Math.max(0, parseFloat(e.target.value) || 0);
        renderFormulatorTab();
      }
    });

    recipeTbody.addEventListener("click", (e) => {
      if (e.target.dataset.del !== undefined) {
        state.recipe.splice(parseInt(e.target.dataset.del, 10), 1);
        renderAll();
        return;
      }
      if (e.target.dataset.fit !== undefined) {
        fitRowToNutrient(parseInt(e.target.dataset.idx, 10), e.target.dataset.fit);
      }
    });

    document.getElementById("btn-export-csv").addEventListener("click", exportFormulationCsv);
    document.getElementById("btn-print").addEventListener("click", () => window.print());

    // TAB 2: 成分限界検討イベント
    document.getElementById("limit-ratio-pattern").addEventListener("change", renderBoundaryTab);
    ["mat-n-src", "mat-p-src", "mat-k-src", "mat-fixed-k", "mat-fixed-mg", "mat-fixed-org"].forEach((id) => {
      document.getElementById(id).addEventListener("input", render2DFeasibilityMatrix);
      document.getElementById(id).addEventListener("change", render2DFeasibilityMatrix);
    });

    document.getElementById("limit-comparison-tbody").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-apply-combo]");
      if (!btn) return;
      const combo = window._cachedBoundaryCombos[parseInt(btn.dataset.applyCombo, 10)];
      if (!combo) return;
      const res = solveFormulation(getRequiredDesignTarget(), combo.config);
      state.recipe = res.items;
      document.querySelector('.nav-tab[data-tab="formulator"]').click();
      renderAll();
    });

    document.getElementById("feasibility-matrix-wrap").addEventListener("click", (e) => {
      const cell = e.target.closest(".m-cell");
      if (!cell) return;
      const n = parseFloat(cell.dataset.mn);
      const p = parseFloat(cell.dataset.mp);
      const k = parseFloat(document.getElementById("mat-fixed-k").value) || 0;
      const mg = parseFloat(document.getElementById("mat-fixed-mg").value) || 0;
      const org = parseFloat(document.getElementById("mat-fixed-org").value) || 0;

      state.target.N = n;
      state.target.P = p;
      state.target.K = k;
      state.target.Mg = mg;
      document.getElementById("target-N").value = n;
      document.getElementById("target-P").value = p;
      document.getElementById("target-K").value = k;
      document.getElementById("target-Mg").value = mg;

      const config = {
        nId: document.getElementById("mat-n-src").value,
        pId: document.getElementById("mat-p-src").value,
        kId: document.getElementById("mat-k-src").value,
        mgId: "magnesium_hydroxide",
        organicId: org > 0 ? "rapeseed_meal" : null,
        organicRatio: org
      };
      const res = solveFormulation(getRequiredDesignTarget(), config);
      state.recipe = res.items;
      document.querySelector('.nav-tab[data-tab="formulator"]').click();
      renderAll();
    });

    // TAB 3: 新規原料追加・編集フォーム（チェックボックス連動）
    document.getElementById("mat-AN").addEventListener("input", (e) => {
      if (parseFloat(e.target.value) > 0) {
        const cb = document.querySelector('input[name="mat-flag"][value="has_an"]');
        if (cb) cb.checked = true;
      }
    });
    document.getElementById("mat-UN").addEventListener("input", (e) => {
      if (parseFloat(e.target.value) > 0) {
        const cb = document.querySelector('input[name="mat-flag"][value="has_un"]');
        if (cb) cb.checked = true;
      }
    });
    document.getElementById("mat-WP").addEventListener("input", (e) => {
      if (parseFloat(e.target.value) > 0) {
        const cb = document.querySelector('input[name="mat-flag"][value="has_wp"]');
        if (cb) cb.checked = true;
      }
    });

    document.getElementById("btn-reset-mat-form").addEventListener("click", () => {
      document.getElementById("material-register-form").reset();
      document.getElementById("edit-mat-id").value = "";
      document.getElementById("material-form-title").textContent = "➕ 追加配合したい肥料原料の登録（チェックボックス式）";
      renderDirectForbiddenCheckboxes();
    });

    document.getElementById("material-register-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const editId = document.getElementById("edit-mat-id").value;
      const checkedFlags = Array.from(document.querySelectorAll('input[name="mat-flag"]:checked')).map((cb) => cb.value);
      const checkedForbids = Array.from(document.querySelectorAll('input[name="mat-forbid"]:checked')).map((cb) => cb.value);

      const matObj = {
        id: editId || "mat_" + Date.now(),
        name: document.getElementById("mat-name").value.trim(),
        category: document.getElementById("mat-category").value,
        pricePerTon: parseFloat(document.getElementById("mat-price").value) || 0,
        N: parseFloat(document.getElementById("mat-N").value) || 0,
        AN: parseFloat(document.getElementById("mat-AN").value) || 0,
        UN: parseFloat(document.getElementById("mat-UN").value) || 0,
        NN: 0,
        P: parseFloat(document.getElementById("mat-P").value) || 0,
        WP: parseFloat(document.getElementById("mat-WP").value) || 0,
        CP: parseFloat(document.getElementById("mat-CP").value) || 0,
        K: parseFloat(document.getElementById("mat-K").value) || 0,
        Mg: parseFloat(document.getElementById("mat-Mg").value) || 0,
        Ca: parseFloat(document.getElementById("mat-Ca").value) || 0,
        Si: parseFloat(document.getElementById("mat-Si").value) || 0,
        S: parseFloat(document.getElementById("mat-S").value) || 0,
        Mn: parseFloat(document.getElementById("mat-Mn").value) || 0,
        B: parseFloat(document.getElementById("mat-B").value) || 0,
        Fe: parseFloat(document.getElementById("mat-Fe").value) || 0,
        Zn: parseFloat(document.getElementById("mat-Zn").value) || 0,
        Cu: parseFloat(document.getElementById("mat-Cu").value) || 0,
        Mo: parseFloat(document.getElementById("mat-Mo").value) || 0,
        flags: checkedFlags,
        forbiddenWith: checkedForbids,
        cautionWith: [],
        note: document.getElementById("mat-note").value.trim(),
        isTempSession: !state.isAdmin
      };

      if (editId) {
        if (!state.isAdmin) {
          alert("既存マスター原料の更新には管理者ログインが必要です。");
          return;
        }
        const idx = window.MASTER_FERTILIZER_DB.materials.findIndex((m) => m.id === editId);
        if (idx >= 0) window.MASTER_FERTILIZER_DB.materials[idx] = matObj;
        saveMasterDatabaseToStorage();
      } else {
        window.MASTER_FERTILIZER_DB.materials.unshift(matObj);
        if (state.isAdmin) {
          saveMasterDatabaseToStorage();
        }
      }

      document.getElementById("btn-reset-mat-form").click();
      renderAll();
      alert(
        state.isAdmin
          ? `✅ 管理者権限で「${matObj.name}」をマスターデータベースへ保存しました！`
          : `ℹ️ 一般利用者モードのため、「${matObj.name}」をこのセッションの一時試算用資材として追加しました（マスター保存には管理者ログインが必要です）。`
      );
    });

    document.getElementById("btn-export-master-json").addEventListener("click", exportMasterJsFile);

    document.getElementById("master-search-input").addEventListener("input", (e) => {
      state.masterSearch = e.target.value;
      renderMasterListTable();
    });

    document.getElementById("master-list-tbody").addEventListener("click", (e) => {
      const useBtn = e.target.closest("[data-use-mat]");
      if (useBtn) {
        const id = useBtn.dataset.useMat;
        const existing = state.recipe.find((it) => it.id === id);
        if (!existing) {
          const mat = getMaterial(id);
          state.recipe.push({ id, ratio: mat && mat.category === "micronutrient" ? 1.5 : 10.0 });
        }
        document.querySelector('.nav-tab[data-tab="formulator"]').click();
        renderAll();
        return;
      }

      const editBtn = e.target.closest("[data-edit-mat]");
      if (editBtn) {
        if (!state.isAdmin) return;
        const m = getMaterial(editBtn.dataset.editMat);
        if (!m) return;
        document.getElementById("edit-mat-id").value = m.id;
        document.getElementById("material-form-title").textContent = `✏️ 原料マスター編集: ${m.name}`;
        document.getElementById("mat-name").value = m.name;
        document.getElementById("mat-category").value = m.category;
        document.getElementById("mat-price").value = m.pricePerTon || 0;
        ["N", "AN", "UN", "P", "WP", "CP", "K", "Mg", "Ca", "Si", "S", "Mn", "B", "Fe", "Zn", "Cu", "Mo"].forEach((k) => {
          const el = document.getElementById(`mat-${k}`);
          if (el) el.value = m[k] || 0;
        });
        document.getElementById("mat-note").value = m.note || "";

        document.querySelectorAll('input[name="mat-flag"]').forEach((cb) => {
          cb.checked = Array.isArray(m.flags) && m.flags.includes(cb.value);
        });
        renderDirectForbiddenCheckboxes(m.id);
        document.querySelectorAll('input[name="mat-forbid"]').forEach((cb) => {
          cb.checked = Array.isArray(m.forbiddenWith) && m.forbiddenWith.includes(cb.value);
        });
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }

      const delBtn = e.target.closest("[data-delete-mat]");
      if (delBtn) {
        if (!state.isAdmin) return;
        const m = getMaterial(delBtn.dataset.deleteMat);
        if (!m) return;
        if (confirm(`マスター原料「${m.name}」を削除してよろしいですか？`)) {
          window.MASTER_FERTILIZER_DB.materials = window.MASTER_FERTILIZER_DB.materials.filter((x) => x.id !== m.id);
          saveMasterDatabaseToStorage();
          renderAll();
        }
      }
    });
  }

  // 起動処理
  initMasterDatabase();
  initDropdowns();
  bindEvents();

  const initialPreset = window.MASTER_FERTILIZER_DB.gradePresets[1];
  state.target = { ...state.target, ...initialPreset.target };
  state.enabledExtras = [...(initialPreset.enabledExtras || [])];
  state.recipe = initialPreset.recipe.map((r) => ({ ...r }));
  renderAll();
})();

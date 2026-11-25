/* =========================================================================
 * app.js — AI로 배우는 AI
 *
 * 상태 모델 (localStorage 하나에 통째로 저장)
 *   {
 *     version: 1,
 *     completed:  { "0-1": true, ... },
 *     outputs:    [ { id, missionId, title, memo, createdAt } ],
 *     recommend:  { experience: 0, goal: 1 } | null,
 *     recommendDismissed: boolean   // 추천 카드를 닫았는지
 *   }
 *
 * 라우팅은 해시 기반 (#track-2, #start, #safety, #cards). 홈은 빈 해시.
 * ========================================================================= */

(function () {
  "use strict";

  // ── 상수 ──────────────────────────────────────────────────────────

  var STORAGE_KEY = "learnai:staff:v1";
  var LEGACY_KEY = "ai-learn-ai:v1";   // 예전 키 (마이그레이션 후 제거)
  var STORAGE_VERSION = 1;

  var CONFIG = window.APP_CONFIG;
  var TRACKS = window.APP_TRACKS;
  var MISSIONS = window.APP_MISSIONS;

  // ── DOM 캐시 ──────────────────────────────────────────────────────

  var $view = document.getElementById("view");
  var $modal = document.getElementById("missionModal");
  var $modalBody = document.getElementById("missionModalBody");
  var $toast = document.getElementById("toast");
  var $nav = document.getElementById("siteNav");

  // 헤더 문구
  document.getElementById("appTitle").textContent = CONFIG.appTitle;
  document.getElementById("appSubtitle").textContent = CONFIG.appSubtitle;
  document.title = CONFIG.appTitle;

  // ── 상태 ──────────────────────────────────────────────────────────

  var state = loadState();

  function loadState() {
    var fallback = {
      version: STORAGE_VERSION,
      completed: {},
      outputs: [],
      recommend: null,
      recommendDismissed: false,
      team: null
    };
    try {
      // 예전 키가 있으면 새 키로 옮기고 예전 키를 제거 (1회성 마이그레이션).
      // 같은 오리진의 일반인 버전(learnai:public:*)과 충돌하지 않기 위함.
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy != null) {
        if (localStorage.getItem(STORAGE_KEY) == null) {
          localStorage.setItem(STORAGE_KEY, legacy);
        }
        localStorage.removeItem(LEGACY_KEY);
      }
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      // 미래에 스키마가 바뀌면 여기서 마이그레이션.
      return {
        version: STORAGE_VERSION,
        completed: parsed.completed || {},
        outputs: Array.isArray(parsed.outputs) ? parsed.outputs : [],
        recommend: parsed.recommend || null,
        recommendDismissed: !!parsed.recommendDismissed,
        team: parsed.team || null
      };
    } catch (err) {
      console.warn("상태 로드 실패, 초기화합니다.", err);
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("저장 실패", err);
    }
  }

  // ── 유틸 ──────────────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k === "html") node.innerHTML = v;
        else if (k.indexOf("on") === 0 && typeof v === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === "dataset") {
          Object.keys(v).forEach(function (dk) { node.dataset[dk] = v[dk]; });
        } else {
          node.setAttribute(k, v);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null || c === false) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // 프롬프트 원문의 [...] 빈칸을 span 으로 감싸 반환 (HTML 문자열).
  function highlightBlanks(promptText) {
    var escaped = escapeHtml(promptText);
    // 대괄호가 여러 줄에 걸치지는 않는다고 가정.
    return escaped.replace(/\[([^\[\]\n]+)\]/g, function (_, inner) {
      return '<span class="blank">[' + inner + "]</span>";
    });
  }

  function missionsByTrack(trackId) {
    return MISSIONS.filter(function (m) { return m.trackId === trackId; });
  }

  function findMission(id) {
    for (var i = 0; i < MISSIONS.length; i++) {
      if (MISSIONS[i].id === id) return MISSIONS[i];
    }
    return null;
  }

  function findTrack(id) {
    for (var i = 0; i < TRACKS.length; i++) {
      if (TRACKS[i].id === id) return TRACKS[i];
    }
    return null;
  }

  function outputsForMission(missionId) {
    return state.outputs.filter(function (o) { return o.missionId === missionId; });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "." + m + "." + day;
  }

  // 확인 창(confirm) 대신 두 번 누르기로 지우기.
  function confirmButton(label, onConfirm, cls) {
    var armed = false, timer = null;
    var btn = el("button", { type: "button", class: cls || "", text: label });
    btn.addEventListener("click", function () {
      if (armed) { clearTimeout(timer); onConfirm(); return; }
      armed = true;
      btn.textContent = "한 번 더 누르면 삭제";
      btn.classList.add("btn--armed");
      timer = setTimeout(function () {
        armed = false;
        btn.textContent = label;
        btn.classList.remove("btn--armed");
      }, 3000);
    });
    return btn;
  }

  // ── 토스트 ────────────────────────────────────────────────────────

  var toastTimer = null;
  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add("toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $toast.classList.remove("toast--show");
    }, 1800);
  }

  // ── 복사 ──────────────────────────────────────────────────────────

  function buildFullPrompt(mission) {
    return mission.prompt + "\n\n" + CONFIG.footer;
  }

  function copyToClipboard(text) {
    // 최신 브라우저 API 우선. 막혀 있으면 textarea 폴백.
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) { reject(e); }
    });
  }

  function copyButton(getText, label, okMsg) {
    var btn = el("button", { type: "button", class: "copy-btn", text: label });
    btn.addEventListener("click", function () {
      copyToClipboard(getText()).then(function () {
        btn.textContent = "✓ 복사됨";
        btn.classList.add("copy-btn--copied");
        toast(okMsg);
        setTimeout(function () {
          btn.textContent = label;
          btn.classList.remove("copy-btn--copied");
        }, 2200);
      }).catch(function () {
        toast("복사가 막혔어요. 글자를 직접 드래그해서 복사해 주세요.");
      });
    });
    return btn;
  }

  // ── 네비게이션 ────────────────────────────────────────────────────

  var NAV = [
    { name: "home",   hash: "",        label: "홈" },
    { name: "start",  hash: "#start",  label: "계정 시작" },
    { name: "safety", hash: "#safety", label: "쓰기 전에 꼭" },
    { name: "skills", hash: "#skills", label: "공용 스킬" },
    { name: "cards",  hash: "#cards",  label: "팀별 사례" }
  ];

  function go(hash) {
    if (location.hash === hash || (!hash && !location.hash)) render();
    else location.hash = hash;
  }

  function renderNav() {
    $nav.innerHTML = "";
    var cur = currentRoute().name;
    NAV.forEach(function (n) {
      $nav.appendChild(el("button", {
        type: "button",
        class: "nav-link" + (cur === n.name ? " nav-link--on" : ""),
        "aria-current": cur === n.name ? "page" : null,
        text: n.label,
        onclick: function () { go(n.hash); }
      }));
    });
    if (CONFIG.links.gallery) {
      $nav.appendChild(el("a", {
        class: "nav-gallery",
        href: CONFIG.links.gallery,
        text: "갤러리"
      }));
    }
    $nav.appendChild(el("a", {
      class: "nav-claude",
      href: CONFIG.links.claude,
      target: "_blank",
      rel: "noopener",
      text: "웹에서 클로드 열기 ↗"
    }));
  }

  // 주소 뒤 #이름 으로 화면을 나눕니다 (#track-2, #start …).
  function currentRoute() {
    var h = location.hash || "";
    var m = h.match(/^#track-(\d+)$/) || h.match(/^#\/track\/(\d+)/);
    if (m) return { name: "track", trackId: parseInt(m[1], 10) };
    if (h === "#start") return { name: "start" };
    if (h === "#safety") return { name: "safety" };
    if (h === "#cards") return { name: "cards" };
    if (h === "#skills") return { name: "skills" };
    return { name: "home" };
  }

  // ── 홈 뷰 ─────────────────────────────────────────────────────────

  function renderHome() {
    $view.innerHTML = "";

    var container = el("div", { class: "home" });

    // 0. 시작하기 (계정 · 보안 · 팀별 사례)
    container.appendChild(renderStartStrip());

    // 1. 트랙 추천 (첫 방문 시)
    if (shouldShowRecommend()) {
      container.appendChild(renderRecommend());
    }

    // 2. 결과물 서랍 (진도율보다 앞)
    container.appendChild(renderOutputsSection());

    // 3. 트랙 선택
    container.appendChild(renderTracksSection());

    $view.appendChild(container);
  }

  function renderStartStrip() {
    var section = el("section", { class: "start-strip" });
    var items = [
      { n: "1", hash: "#start",  title: "계정 시작",     text: "앱 설치·초대 수락부터 첫 대화까지" },
      { n: "2", hash: "#safety", title: "쓰기 전에 꼭",   text: "넣으면 안 되는 것, 기관 계정 수칙" },
      { n: "3", hash: "#cards",  title: "우리 팀 사례",  text: "미션 빈칸에 넣어 볼 업무 예시" },
      { n: "4", hash: "#skills", title: "공용 스킬 6종", text: "말로 부탁하면 꺼내 쓰는 우리 과 작업 설명서" }
    ];
    items.forEach(function (it) {
      section.appendChild(el("button", {
        type: "button",
        class: "start-card",
        onclick: function () { go(it.hash); }
      }, [
        el("span", { class: "start-card__n", text: it.n }),
        el("span", { class: "start-card__body" }, [
          el("strong", { class: "start-card__title", text: it.title }),
          el("span", { class: "start-card__text", text: it.text })
        ])
      ]));
    });
    return section;
  }

  // ── 계정 시작 ─────────────────────────────────────────────────────

  function pageHead(title, lede) {
    var head = el("div", { class: "page-head" });
    head.appendChild(el("h1", { class: "track-detail__title", text: title }));
    if (lede) head.appendChild(el("p", { class: "page-lede", text: lede }));
    return head;
  }

  function renderStart() {
    $view.innerHTML = "";
    var c = el("div", { class: "page" });
    c.appendChild(pageHead("계정 시작", CONFIG.start.lede));

    var ol = el("ol", { class: "steps" });
    CONFIG.start.steps.forEach(function (st, i) {
      var li = el("li", { class: "step" });
      li.appendChild(el("span", { class: "step__n", text: String(i + 1) }));
      var b = el("div", { class: "step__body" });
      b.appendChild(el("h3", { class: "step__title", text: st.title }));
      b.appendChild(el("p", { class: "step__text", text: st.body }));
      if (st.warn) b.appendChild(el("p", { class: "callout callout--warn", text: "⚠ " + st.warn }));
      li.appendChild(b);
      ol.appendChild(li);
    });
    c.appendChild(ol);

    var row = el("div", { class: "page-actions" });
    row.appendChild(el("a", {
      class: "copy-btn link-btn",
      href: CONFIG.links.download, target: "_blank", rel: "noopener",
      text: "데스크톱 앱 받기 ↗"
    }));
    row.appendChild(el("button", {
      type: "button", class: "ghost-btn", text: "첫 미션 열기 (0-1)",
      onclick: function () { openMission("0-1"); }
    }));
    c.appendChild(row);
    if (CONFIG.contact) c.appendChild(el("p", { class: "page-note", text: CONFIG.contact }));
    $view.appendChild(c);
  }

  // ── 쓰기 전에 꼭 ──────────────────────────────────────────────────

  function renderSafety() {
    $view.innerHTML = "";
    var S = CONFIG.safety;
    var c = el("div", { class: "page" });
    c.appendChild(pageHead("쓰기 전에 꼭", "클로드에 무엇을 넣어도 되는지, 기관 계정을 어떻게 쓰는지 한 장으로 정리했어요."));

    var grid = el("div", { class: "dodont" });
    function col(title, list, cls) {
      var box = el("div", { class: "dodont__col " + cls });
      box.appendChild(el("h2", { class: "dodont__title", text: title }));
      var ul = el("ul");
      list.forEach(function (x) { ul.appendChild(el("li", { text: x })); });
      box.appendChild(ul);
      return box;
    }
    grid.appendChild(col("넣지 말 것", S.dont, "dodont__col--no"));
    grid.appendChild(col("넣어도 되는 것", S.ok, "dodont__col--yes"));
    c.appendChild(grid);

    c.appendChild(el("h2", { class: "section__title page-sub", text: "기관 계정 수칙" }));
    var rules = el("div", { class: "rules" });
    S.rules.forEach(function (r) {
      rules.appendChild(el("div", { class: "rule" }, [
        el("h3", { class: "rule__title", text: r.title }),
        el("p", { class: "rule__text", text: r.body })
      ]));
    });
    c.appendChild(rules);

    c.appendChild(el("h2", { class: "section__title page-sub", text: "자주 묻는 질문" }));
    var faq = el("div", { class: "faq" });
    faq.appendChild(el("p", { class: "faq__q", text: "Q. " + S.faq.q }));
    faq.appendChild(el("p", { class: "faq__a", text: S.faq.a }));
    var table = el("table", { class: "faq__table" });
    S.faq.rows.forEach(function (r, i) {
      var tr = el("tr");
      r.forEach(function (cell) { tr.appendChild(el(i === 0 ? "th" : "td", { text: cell })); });
      table.appendChild(tr);
    });
    faq.appendChild(el("div", { class: "table-wrap" }, table));
    c.appendChild(faq);
    $view.appendChild(c);
  }

  // ── 공용 스킬 ─────────────────────────────────────────────────────

  function renderSkills() {
    $view.innerHTML = "";
    var K = CONFIG.skills;
    var c = el("div", { class: "page" });
    c.appendChild(pageHead("공용 스킬", K.lede));

    var how = el("ol", { class: "plain-steps" });
    K.howto.forEach(function (x) { how.appendChild(el("li", { text: x })); });
    c.appendChild(how);

    c.appendChild(el("h2", { class: "section__title page-sub", text: "6종 한눈에 보기" }));
    var list = el("div", { class: "cases" });
    K.list.forEach(function (k) {
      var card = el("article", { class: "case-card skill-card" });
      card.appendChild(el("p", { class: "skill-card__name", text: k.name }));
      card.appendChild(el("h3", { class: "case-card__title", text: k.title }));
      card.appendChild(el("dl", { class: "skill-card__dl" }, [
        el("dt", { text: "이럴 때" }), el("dd", { text: k.when }),
        el("dt", { text: "결과물" }), el("dd", { text: k.output })
      ]));
      card.appendChild(el("p", { class: "case-card__label", text: "이렇게 말해 보세요" }));
      card.appendChild(el("pre", { class: "prompt-block prompt-block--example", text: k.say }));
      card.appendChild(el("div", { class: "copy-row" }, [
        copyButton(function () { return k.say; }, "예시 복사", "복사됐어요. 내 업무에 맞게 바꿔서 클로드에 붙여 넣으세요.")
      ]));
      if (k.tips && k.tips.length) {
        var ul = el("ul", { class: "skill-card__tips" });
        k.tips.forEach(function (t) { ul.appendChild(el("li", { text: t })); });
        card.appendChild(ul);
      }
      list.appendChild(card);
    });
    c.appendChild(list);

    var rules = el("div", { class: "callout callout--warn" });
    rules.appendChild(el("p", { class: "callout__title", text: "꼭 지켜 주세요" }));
    var rl = el("ul");
    K.rules.forEach(function (x) { rl.appendChild(el("li", { text: x })); });
    rules.appendChild(rl);
    c.appendChild(rules);

    // 스킬 만들기·나누기
    c.appendChild(el("h2", { class: "section__title page-sub", text: "스킬을 만들고 나누기" }));
    var table = el("table", { class: "faq__table" });
    K.vs.forEach(function (r, i) {
      var tr = el("tr");
      r.forEach(function (cell, j) { tr.appendChild(el(i === 0 || j === 0 ? "th" : "td", { text: cell })); });
      table.appendChild(tr);
    });
    c.appendChild(el("div", { class: "table-wrap faq" }, table));

    var flow = el("ol", { class: "steps steps--flow" });
    K.flow.forEach(function (f, i) {
      flow.appendChild(el("li", { class: "step" }, [
        el("span", { class: "step__n", text: String(i + 1) }),
        el("div", { class: "step__body" }, [
          el("h3", { class: "step__title", text: f.title }),
          el("p", { class: "step__text", text: f.body })
        ])
      ]));
    });
    c.appendChild(flow);

    var row = el("div", { class: "page-actions" });
    ["3-4", "3-5", "1-4"].forEach(function (mid) {
      var m = findMission(mid);
      if (m) row.appendChild(el("button", {
        type: "button", class: "ghost-btn", text: mid + " " + m.title,
        onclick: function () { openMission(mid); }
      }));
    });
    c.appendChild(row);

    var nc = el("div", { class: "rule nocode" });
    nc.appendChild(el("h3", { class: "rule__title", text: "만들 줄 몰라도 괜찮아요" }));
    nc.appendChild(el("p", { class: "rule__text", text: K.noCode }));
    var cl = el("ul", { class: "skill-card__tips" });
    K.candidates.forEach(function (x) { cl.appendChild(el("li", { text: x[0] + " — " + x[1] })); });
    nc.appendChild(el("p", { class: "rule__text", text: "이런 것들이 스킬 후보가 될 수 있어요." }));
    nc.appendChild(cl);
    if (CONFIG.links.ideaForm) {
      nc.appendChild(el("a", {
        class: "copy-btn link-btn", href: CONFIG.links.ideaForm, target: "_blank", rel: "noopener",
        text: "스킬 후보·함께 정리할 정보 알려 주기 ↗"
      }));
    } else {
      nc.appendChild(el("p", { class: "page-note", text: "후보를 알려 주는 양식은 곧 열어요. 그 전에는 담당자에게 바로 말해 주세요." }));
    }
    c.appendChild(nc);
    $view.appendChild(c);
  }

  // ── 팀별 사례 카드 ────────────────────────────────────────────────

  function findTeam(id) {
    for (var i = 0; i < CONFIG.teamCards.length; i++) {
      if (CONFIG.teamCards[i].id === id) return CONFIG.teamCards[i];
    }
    return CONFIG.teamCards[0];
  }

  function renderCaseCard(cs) {
    var card = el("article", { class: "case-card" });
    card.appendChild(el("h3", { class: "case-card__title", text: cs.title }));
    card.appendChild(el("p", { class: "case-card__situation", text: cs.situation }));
    var chips = el("div", { class: "chips" });
    chips.appendChild(el("span", { class: "chips__label", text: "어울리는 미션" }));
    cs.missions.forEach(function (mid) {
      var m = findMission(mid);
      if (!m) return;
      chips.appendChild(el("button", {
        type: "button", class: "chip", text: mid + " " + m.title,
        onclick: function () { openMission(mid); }
      }));
    });
    card.appendChild(chips);
    card.appendChild(el("p", { class: "case-card__label", text: "빈칸에 넣어 볼 예시" }));
    card.appendChild(el("pre", { class: "prompt-block prompt-block--example", text: cs.fill }));
    card.appendChild(el("div", { class: "copy-row" }, [
      copyButton(function () { return cs.fill; }, "예시 복사", "복사됐어요. 미션 프롬프트의 빈칸 자리에 붙여 넣으세요.")
    ]));
    return card;
  }

  function renderCards() {
    $view.innerHTML = "";
    var c = el("div", { class: "page" });
    c.appendChild(pageHead("팀별 사례 카드", "미션 프롬프트의 [빈칸]을 우리 팀 업무로 채워 보는 예시예요. 실제 자료는 이미 공개된 것만 쓰세요."));

    var team = findTeam(state.team);
    var tabs = el("div", { class: "tabs", role: "tablist" });
    CONFIG.teamCards.forEach(function (t) {
      tabs.appendChild(el("button", {
        type: "button", role: "tab",
        class: "tab" + (t.id === team.id ? " tab--on" : ""),
        "aria-selected": t.id === team.id ? "true" : "false",
        text: t.team,
        onclick: function () { state.team = t.id; saveState(); renderCards(); }
      }));
    });
    c.appendChild(tabs);

    var list = el("div", { class: "cases" });
    team.cases.forEach(function (cs) { list.appendChild(renderCaseCard(cs)); });
    c.appendChild(list);
    $view.appendChild(c);
  }

  function shouldShowRecommend() {
    if (state.recommendDismissed) return false;
    return true;
  }

  function renderRecommend() {
    var section = el("section", { class: "recommend" });

    var header = el("div", { class: "recommend__header" }, [
      el("h2", { class: "recommend__title", text: "어느 트랙부터 시작할까요?" }),
      el("button", {
        class: "recommend__toggle",
        type: "button",
        text: "나중에",
        onclick: function () {
          state.recommendDismissed = true;
          saveState();
          renderHome();
        }
      })
    ]);
    section.appendChild(header);

    section.appendChild(el("p", {
      class: "recommend__lede",
      text: "두 질문에만 답해도 트랙 하나를 알려드려요. 어느 트랙이든 바로 들어가도 됩니다."
    }));

    var questions = el("div", { class: "recommend__questions" });
    var current = state.recommend || {};

    CONFIG.recommend.questions.forEach(function (q) {
      var qBox = el("div", { class: "recommend__q" });
      qBox.appendChild(el("p", { class: "recommend__q-text", text: q.text }));

      var opts = el("div", { class: "recommend__opts" });
      q.options.forEach(function (opt) {
        var isOn = current[q.id] === opt.trackId;
        opts.appendChild(el("button", {
          type: "button",
          class: "recommend__opt" + (isOn ? " recommend__opt--on" : ""),
          text: opt.label,
          onclick: function () {
            var next = Object.assign({}, state.recommend || {});
            next[q.id] = opt.trackId;
            state.recommend = next;
            saveState();
            renderHome();
          }
        }));
      });
      qBox.appendChild(opts);
      questions.appendChild(qBox);
    });
    section.appendChild(questions);

    // 두 답 모두 있으면 결과 표시
    var recTrackId = computeRecommendedTrack();
    if (recTrackId != null) {
      var t = findTrack(recTrackId);
      var res = el("div", { class: "recommend__result" });
      res.appendChild(el("span", { text: "이 트랙이 가장 편해 보여요: " }));
      res.appendChild(el("strong", { text: "트랙 " + t.id + " · " + t.title }));
      res.appendChild(el("span", { text: " — 카드에도 표시해 뒀어요. 다른 트랙을 골라도 좋습니다." }));
      section.appendChild(res);
    }

    return section;
  }

  function computeRecommendedTrack() {
    var r = state.recommend;
    if (!r) return null;
    var vals = CONFIG.recommend.questions.map(function (q) { return r[q.id]; });
    if (vals.some(function (v) { return v == null; })) return null;
    // 두 답 중 더 낮은 트랙(초심자 쪽)을 추천.
    return Math.min.apply(null, vals);
  }

  function renderOutputsSection() {
    var section = el("section", { class: "section" });
    section.appendChild(el("div", { class: "section__header" }, [
      el("h2", { class: "section__title", text: "내가 만든 것" }),
      el("p", {
        class: "section__hint",
        text: state.outputs.length ? state.outputs.length + "개" : ""
      })
    ]));

    if (state.outputs.length === 0) {
      section.appendChild(el("div", {
        class: "empty-state",
        text: "미션을 하나 끝내면 여기에 결과물이 쌓입니다. 진도율보다 이쪽이 훨씬 강한 동기가 되거든요."
      }));
    } else {
      var list = el("div", { class: "outputs" });
      // 최신 순.
      var sorted = state.outputs.slice().sort(function (a, b) {
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      });
      sorted.forEach(function (o) {
        var mission = findMission(o.missionId);
        var card = el("div", { class: "output-card" });

        var meta = el("div", { class: "output-card__meta" });
        meta.appendChild(el("span", {
          class: "output-card__mission-id",
          text: mission ? mission.id : o.missionId
        }));
        if (mission) {
          meta.appendChild(el("span", { text: mission.title }));
        }
        if (o.createdAt) {
          meta.appendChild(el("span", { text: "· " + formatDate(o.createdAt) }));
        }
        card.appendChild(meta);

        card.appendChild(el("h3", {
          class: "output-card__title",
          text: o.title || "(제목 없음)"
        }));
        if (o.memo) {
          card.appendChild(el("p", { class: "output-card__memo", text: o.memo }));
        }

        var actions = el("div", { class: "output-card__actions" });
        if (mission) {
          actions.appendChild(el("button", {
            type: "button",
            text: "미션 열기",
            onclick: function () { openMission(mission.id); }
          }));
        }
        actions.appendChild(confirmButton("삭제", function () {
          state.outputs = state.outputs.filter(function (x) { return x.id !== o.id; });
          saveState();
          renderHome();
        }));
        card.appendChild(actions);

        list.appendChild(card);
      });
      section.appendChild(list);
    }
    return section;
  }

  function renderTracksSection() {
    var section = el("section", { class: "section" });
    section.appendChild(el("div", { class: "section__header" }, [
      el("h2", { class: "section__title", text: "트랙 고르기" }),
      el("p", { class: "section__hint", text: "순서 상관 없어요. 자기 수준에 맞는 걸로." })
    ]));

    var recommendedId = computeRecommendedTrack();

    var grid = el("div", { class: "tracks" });
    TRACKS.forEach(function (t) {
      var missions = missionsByTrack(t.id);
      var doneCount = missions.filter(function (m) {
        return state.completed[m.id];
      }).length;
      var isRec = t.id === recommendedId;
      var isFull = missions.length > 0 && doneCount === missions.length;

      var card = el("button", {
        type: "button",
        class: "track-card" + (isRec ? " track-card--recommended" : ""),
        onclick: function () { go("#track-" + t.id); }
      });

      card.appendChild(el("div", { class: "track-card__top" }, [
        el("span", { class: "track-card__label", text: "트랙 " + t.id }),
        el("span", {
          class: "track-card__progress" + (isFull ? " track-card__progress--full" : ""),
          text: doneCount + " / " + missions.length + " 완료"
        })
      ]));
      card.appendChild(el("h3", { class: "track-card__title", text: t.title }));
      if (isRec) {
        card.appendChild(el("span", { class: "track-card__rec-badge", text: "추천" }));
      }
      card.appendChild(el("p", { class: "track-card__meta" }, [
        el("strong", { text: "대상" }),
        document.createTextNode(" · " + t.target)
      ]));
      card.appendChild(el("p", { class: "track-card__meta" }, [
        el("strong", { text: "목표" }),
        document.createTextNode(" · " + t.goal)
      ]));

      grid.appendChild(card);
    });
    section.appendChild(grid);
    return section;
  }

  // ── 트랙 상세 뷰 ──────────────────────────────────────────────────

  function renderTrackDetail(trackId) {
    $view.innerHTML = "";
    var track = findTrack(trackId);
    if (!track) {
      $view.appendChild(el("p", { text: "트랙을 찾을 수 없어요." }));
      return;
    }

    var container = el("div", { class: "track-detail" });

    container.appendChild(el("button", {
      class: "track-detail__back",
      type: "button",
      text: "← 홈으로",
      onclick: function () { go(""); }
    }));
    container.appendChild(el("p", {
      class: "track-card__label",
      text: "트랙 " + track.id
    }));
    container.appendChild(el("h1", { class: "track-detail__title", text: track.title }));
    container.appendChild(el("p", { class: "track-detail__meta" }, [
      el("strong", { text: "대상" }),
      document.createTextNode(" · " + track.target + "  ·  "),
      el("strong", { text: "목표" }),
      document.createTextNode(" · " + track.goal)
    ]));

    var missions = missionsByTrack(trackId);
    var list = el("div", { class: "missions" });

    missions.forEach(function (m) {
      var done = !!state.completed[m.id];
      var card = el("article", { class: "mission-card" });

      card.appendChild(el("div", { class: "mission-card__id", text: m.id }));

      var body = el("div", { class: "mission-card__body" });
      var titleRow = el("div", { class: "mission-card__title-row" });
      titleRow.appendChild(el("h3", { class: "mission-card__title", text: m.title }));
      if (m.deferred) {
        titleRow.appendChild(el("span", {
          class: "badge badge--defer",
          text: "며칠 뒤에 해도 되는 미션"
        }));
      }
      body.appendChild(titleRow);
      body.appendChild(el("p", { class: "mission-card__purpose", text: m.purpose }));
      card.appendChild(body);

      var actions = el("div", { class: "mission-card__actions" });
      if (done) {
        actions.appendChild(el("span", {
          class: "mission-card__done-mark",
          text: "✓ 완료"
        }));
      }
      actions.appendChild(el("button", {
        type: "button",
        class: "mission-card__open",
        text: done ? "다시 열기" : "프롬프트 열기",
        onclick: function () { openMission(m.id); }
      }));
      card.appendChild(actions);

      list.appendChild(card);
    });

    container.appendChild(list);
    $view.appendChild(container);
  }

  // ── 미션 모달 ─────────────────────────────────────────────────────

  function openMission(missionId) {
    var mission = findMission(missionId);
    if (!mission) return;

    $modalBody.innerHTML = "";
    var body = renderMissionDetail(mission);
    $modalBody.appendChild(body);

    $modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closeMission() {
    $modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    // 홈/트랙 상세의 진도 표시를 최신화.
    render();
  }

  function renderMissionDetail(mission) {
    var wrap = el("div", { class: "mission-detail" });

    var idRow = el("p", { class: "mission-detail__id" }, [
      document.createTextNode("미션 " + mission.id)
    ]);
    if (mission.deferred) {
      idRow.appendChild(document.createTextNode("  "));
      idRow.appendChild(el("span", {
        class: "badge badge--defer",
        text: "며칠 뒤에 해도 되는 미션"
      }));
    }
    wrap.appendChild(idRow);

    wrap.appendChild(el("h2", { class: "mission-detail__title", text: mission.title }));
    wrap.appendChild(el("p", { class: "mission-detail__purpose", text: mission.purpose }));

    // 프롬프트 (빈칸 하이라이트)
    var promptBlock = el("pre", { class: "prompt-block" });
    promptBlock.innerHTML = highlightBlanks(mission.prompt);
    wrap.appendChild(promptBlock);
    wrap.appendChild(el("p", {
      class: "prompt-hint",
      text: "색으로 강조된 [부분]은 본인 상황에 맞게 바꿔서 쓰세요."
    }));

    if (mission.screen && mission.screen.length) {
      var sg = el("div", { class: "callout" });
      sg.appendChild(el("p", { class: "callout__title", text: "화면에서 같이 보기" }));
      var ul = el("ul");
      mission.screen.forEach(function (x) { ul.appendChild(el("li", { text: x })); });
      sg.appendChild(ul);
      wrap.appendChild(sg);
    }
    if (mission.note) {
      wrap.appendChild(el("p", { class: "callout callout--warn", text: mission.note }));
    }

    // 이 미션에 어울리는 팀별 사례
    var related = [];
    CONFIG.teamCards.forEach(function (t) {
      t.cases.forEach(function (cs) {
        if (cs.missions.indexOf(mission.id) >= 0) related.push({ team: t, cs: cs });
      });
    });
    if (related.length) {
      var rel = el("details", { class: "related" });
      rel.appendChild(el("summary", { text: "우리 팀 예시로 빈칸 채우기 (" + related.length + ")" }));
      related.forEach(function (r) {
        var box = el("div", { class: "related__item" });
        box.appendChild(el("p", { class: "related__title", text: r.team.team + " · " + r.cs.title }));
        box.appendChild(el("pre", { class: "prompt-block prompt-block--example", text: r.cs.fill }));
        box.appendChild(copyButton(function () { return r.cs.fill; }, "예시 복사", "복사됐어요. 빈칸 자리에 붙여 넣으세요."));
        rel.appendChild(box);
      });
      wrap.appendChild(rel);
    }

    // 복사 버튼
    var copyRow = el("div", { class: "copy-row" });
    copyRow.appendChild(copyButton(function () { return buildFullPrompt(mission); },
      "프롬프트 복사", "복사됐어요. 옆의 클로드 대화창에 붙여 넣으세요."));
    copyRow.appendChild(el("p", {
      class: "copy-note",
      text: "복사한 뒤 옆에 띄운 클로드 앱(또는 웹)의 대화창에 붙여 넣으세요. 꼬리말 한 줄 “막히면 한 번에 한 단계씩 안내해줘.”가 자동으로 붙어요."
    }));
    wrap.appendChild(copyRow);

    // 완료 / 결과물
    var controls = el("div", { class: "mission-controls" });
    var done = !!state.completed[mission.id];

    // 결과물 폼 상태
    var formOpen = { value: false };
    var toggleBtn = el("button", {
      type: "button",
      class: "mission-controls__toggle" + (done ? " mission-controls__toggle--done" : ""),
      text: done ? "✓ 완료함 (누르면 취소)" : "완료로 표시 + 결과물 남기기"
    });

    var formHolder = el("div");

    function refreshToggle() {
      var d = !!state.completed[mission.id];
      toggleBtn.textContent = d ? "✓ 완료함 (누르면 취소)" : "완료로 표시 + 결과물 남기기";
      toggleBtn.classList.toggle("mission-controls__toggle--done", d);
    }

    toggleBtn.addEventListener("click", function () {
      var currentlyDone = !!state.completed[mission.id];
      if (currentlyDone) {
        // 완료 취소 (결과물은 남겨둠)
        delete state.completed[mission.id];
        saveState();
        refreshToggle();
        toast("완료 표시를 취소했어요.");
      } else {
        // 완료 처리 + 결과물 폼 열기
        state.completed[mission.id] = true;
        saveState();
        refreshToggle();
        formOpen.value = true;
        renderForm();
      }
    });

    controls.appendChild(toggleBtn);
    controls.appendChild(formHolder);

    function renderForm() {
      formHolder.innerHTML = "";
      if (!formOpen.value) return;

      var form = el("div", { class: "output-form" });
      form.appendChild(el("p", {
        class: "output-form__label",
        text: "이 미션에서 뭐가 나왔어요? (스킵해도 완료는 유지됩니다)"
      }));
      var titleInput = el("input", {
        type: "text",
        placeholder: "결과물 제목 — 예: 학교 안내 공문 초안"
      });
      var memoInput = el("textarea", {
        rows: "3",
        placeholder: "짧은 메모 (선택). AI가 뭘 짚어줬는지, 어떤 걸 배웠는지."
      });
      form.appendChild(titleInput);
      form.appendChild(memoInput);

      var actions = el("div", { class: "output-form__actions" });
      actions.appendChild(el("button", {
        type: "button",
        class: "output-form__skip",
        text: "메모 없이 닫기",
        onclick: function () {
          formOpen.value = false;
          renderForm();
        }
      }));
      actions.appendChild(el("button", {
        type: "button",
        class: "output-form__save",
        text: "결과물 저장",
        onclick: function () {
          var title = titleInput.value.trim();
          var memo = memoInput.value.trim();
          if (!title && !memo) {
            toast("제목이나 메모 중 하나는 있어야 해요.");
            return;
          }
          state.outputs.push({
            id: "o_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
            missionId: mission.id,
            title: title || "(제목 없음)",
            memo: memo,
            createdAt: new Date().toISOString()
          });
          saveState();
          formOpen.value = false;
          renderForm();
          renderMissionOutputs();
          toast("결과물이 홈에 저장됐어요.");
        }
      }));
      form.appendChild(actions);

      formHolder.appendChild(form);
      // 접근성: 첫 입력에 포커스.
      setTimeout(function () { titleInput.focus(); }, 40);
    }

    // 이 미션에 이미 저장된 결과물 목록
    var outputsHolder = el("div");
    controls.appendChild(outputsHolder);

    function renderMissionOutputs() {
      outputsHolder.innerHTML = "";
      var list = outputsForMission(mission.id);
      if (list.length === 0) return;

      var box = el("div", { class: "mission-outputs" });
      box.appendChild(el("p", {
        class: "mission-outputs__title",
        text: "이 미션의 결과물 " + list.length + "개"
      }));
      list.forEach(function (o) {
        var item = el("div", { class: "mission-outputs__item" });
        var body = el("div", { class: "mission-outputs__item-body" });
        body.appendChild(el("p", {
          class: "mission-outputs__item-title",
          text: o.title || "(제목 없음)"
        }));
        if (o.memo) {
          body.appendChild(el("p", {
            class: "mission-outputs__item-memo",
            text: o.memo
          }));
        }
        item.appendChild(body);
        item.appendChild(confirmButton("삭제", function () {
          state.outputs = state.outputs.filter(function (x) { return x.id !== o.id; });
          saveState();
          renderMissionOutputs();
        }, "mission-outputs__delete"));
        box.appendChild(item);
      });
      outputsHolder.appendChild(box);
    }

    renderMissionOutputs();

    wrap.appendChild(controls);
    return wrap;
  }

  // 모달 닫기: 배경/닫기 버튼/ESC.
  Array.prototype.forEach.call(
    document.querySelectorAll("[data-close-modal]"),
    function (n) { n.addEventListener("click", closeMission); }
  );
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && $modal.getAttribute("aria-hidden") === "false") {
      closeMission();
    }
  });

  // ── 라우팅 ────────────────────────────────────────────────────────

  function render() {
    var r = currentRoute();
    if (r.name === "track") renderTrackDetail(r.trackId);
    else if (r.name === "start") renderStart();
    else if (r.name === "safety") renderSafety();
    else if (r.name === "cards") renderCards();
    else if (r.name === "skills") renderSkills();
    else renderHome();
    renderNav();
    window.scrollTo(0, 0);
  }

  // 미션 창이 열린 채로 다른 화면으로 옮기면 창을 닫고 그립니다.
  window.addEventListener("hashchange", function () {
    if ($modal.getAttribute("aria-hidden") === "false") {
      $modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
    render();
  });
  render();

})();

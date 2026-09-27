// ==UserScript==
// @name         Anime Tracker — liens depuis SIMKL / MAL
// @namespace    anime-tracker
// @version      1.1
// @description  Ajoute un lien vers l'Anime Tracker sur les pages anime de SIMKL et MyAnimeList.
// @match        https://simkl.com/anime/*
// @match        https://myanimelist.net/anime/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// The app side is `/go/<provider>/<id>` (src/pages/go/[provider]/[id].tsx):
// it resolves a provider id against the registry and redirects to the
// canonical record. Nothing here fetches the app — a plain link from an HTTPS
// page to the HTTP NAS is fine, a fetch would be blocked as mixed content.

(function () {
  'use strict';

  const APP = 'http://192.168.1.15:12350';
  const MARK = 'data-anime-tracker-link';

  function idFrom(href, re) {
    const m = re.exec(href || '');
    return m ? m[1] : null;
  }

  // SIMKL: a new block in the ratings row, right after MyAnimeList's.
  function injectSimkl() {
    if (document.querySelector(`[${MARK}]`)) return;
    const simklId = idFrom(location.pathname, /^\/anime\/(\d+)/);
    // No MAL block on titles MAL has no score for yet (a new season); fall back
    // to SIMKL's own block, which every page carries.
    const anchor =
      document.querySelector('td.SimklTVAboutRatingsBlockTD.mal-rating') ??
      document.querySelector('td.SimklTVAboutRatingsBlockTD.simkl-rating') ??
      document.querySelector('td.SimklTVAboutRatingsBlockTD');
    if (!simklId || !anchor) return;

    const params = new URLSearchParams();
    const mal = idFrom(document.querySelector('a[href*="myanimelist.net/anime/"]')?.href, /myanimelist\.net\/anime\/(\d+)/);
    const anilist = idFrom(document.querySelector('a[href*="anilist.co/anime/"]')?.href, /anilist\.co\/anime\/(\d+)/);
    if (mal) params.set('mal', mal);
    if (anilist) params.set('anilist', anilist);
    const qs = params.toString();

    const cell = document.createElement('td');
    cell.className = 'SimklTVAboutRatingsBlockTD';
    cell.setAttribute(MARK, '');
    cell.innerHTML = `
      <a href="${APP}/go/simkl/${simklId}${qs ? '?' + qs : ''}" target="_blank"
         style="display:block;text-decoration:none;color:#fff;height:100%">
        <table width="100%" border="0" cellspacing="0" cellpadding="0"
               class="SimklTVAboutRatingBorder SimklTVAboutRatingBorderClick" style="height:100%">
          <tbody>
            <tr><td align="center" style="font-size:28px;line-height:1">📺</td></tr>
            <tr><td align="center" style="font-weight:bold;padding-top:6px;color:#fff">Anime Tracker</td></tr>
          </tbody>
        </table>
      </a>`;
    anchor.after(cell);
  }

  // MAL: a small pill beside the title.
  function injectMal() {
    if (document.querySelector(`[${MARK}]`)) return;
    const malId = idFrom(location.pathname, /^\/anime\/(\d+)/);
    const h1 = document.querySelector('h1.title-name');
    if (!malId || !h1) return;

    const link = document.createElement('a');
    link.setAttribute(MARK, '');
    link.href = `${APP}/go/mal/${malId}`;
    link.target = '_blank';
    link.textContent = '📺 Anime Tracker';
    link.style.cssText =
      'margin-left:12px;padding:2px 8px;border-radius:4px;font-size:12px;vertical-align:middle;' +
      'background:#2e51a2;color:#fff;text-decoration:none;font-weight:normal';
    h1.appendChild(link);
  }

  const inject = location.hostname.endsWith('simkl.com') ? injectSimkl : injectMal;
  inject();
  // SIMKL swaps parts of the page in place; re-check cheaply (inject is idempotent).
  new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
})();

// owns: R3, R10, R15 · discovery — D03 proposal words, escaping and current-radius labels.
import assert from "node:assert/strict";
import { suite, withRoot } from "./_harness.mjs";
import { setup } from "./_bookings.mjs";
import { seedStories } from "./_fixture.mjs";
import { propose } from "../discovery/doors/index.mjs";
import { loadPrd, savePrd } from "../discovery/workshop/index.mjs";
import { readDoc, saveDoc, PROTOTYPE_FILE } from "../discovery/record/index.mjs";
import { serve } from "../shared/console/index.mjs";
import { routes, nav } from "../discovery/console/index.mjs";

const { check, done } = suite("discovery-proposal-display", 5);
const markup = '<img src=x onerror="alert(1)"> & \'quoted\'';
const escape = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
for (const kind of ["addition", "rewording", "fallback", "labels", "escaping"]) {
  try {
    await withRoot({}, async parent => {
      const { root, backlog } = await setup(parent);
      const prd = loadPrd(root);
      const old = "Cancellation releases the reservation. " + markup;
      prd.requirements[0].acceptance_criteria[0].statement = old;
      savePrd(root, prd);
      const newWords = "Cancellation is unavailable after pickup. " + markup;
      const criterion = { id: "AC-3", statement: newWords };
      const target = kind === "fallback" ? "/requirements/0/statement" : ["addition", "labels"].includes(kind) ? "/requirements/0/acceptance_criteria/-" : "/requirements/0/acceptance_criteria/0/statement";
      const to = ["addition", "labels"].includes(kind) ? criterion : newWords;
      const { amendment } = propose({ root, target, to, rationale: "Policy " + markup, by: "PM " + markup });
      // Labels must read the currently affected records, not text captured at mint.
      backlog.stories[0].statement = "As a member, I want to cancel my current booking, so that equipment is available. " + markup;
      seedStories(root, backlog);
      const proto = readDoc(root, PROTOTYPE_FILE);
      proto.screens[0].name = "Current booking screen " + markup;
      saveDoc(root, PROTOTYPE_FILE, "prototype", proto);
      const srv = await serve({ routes: routes({ root }), nav, port: 0 });
      try {
        const response = await fetch(srv.url + "/board");
        assert.equal(response.status, 200);
        const html = await response.text();
        const row = html.match(/<tr>[\s\S]*?<\/tr>/g).find(r => r.includes(`value="${amendment.id}"`));
        assert.ok(row, "proposal row exists");
        const cells = [...row.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(m => m[1]);
        assert.equal(cells.length, 5);
        if (kind === "addition" || kind === "rewording") {
          assert.ok(cells[1].includes(escape(newWords)), "criterion statement is visible");
          assert.ok(!cells[1].includes("&quot;statement&quot;"), "criterion addition is words, not an object");
          assert.ok(!cells[1].includes(escape(JSON.stringify(newWords))), "criterion wording is not a JSON string");
          if (kind === "rewording") assert.ok(cells[1].includes(escape(old)), "old statement remains visible");
        }
        if (kind === "fallback") {
          assert.ok(cells[1].includes(escape(JSON.stringify(to))), "non-criterion retains JSON value");
          assert.ok(cells[1].includes(escape(JSON.stringify(prd.requirements[0].statement))), "non-criterion retains old JSON value");
        }
        if (kind === "labels") {
          const expected = { "REQ-1/AC-1": old, "REQ-1/AC-2": prd.requirements[0].acceptance_criteria[1].statement, "STORY-1": backlog.stories[0].statement, "SCREEN-1": proto.screens[0].name };
          const labels = [...cells[4].matchAll(/<label class="check"[^>]*>([\s\S]*?)<\/label>/g)].map(m => m[1]);
          const ids = labels.map(l => l.match(/value="([^"]+)"/)[1]);
          assert.deepEqual(ids.sort(), Object.keys(expected).sort());
          for (const [id, words] of Object.entries(expected)) {
            assert.ok(cells[3].includes(escape(words)), `radius describes ${id}`);
            assert.ok(labels.find(l => l.includes(`value="${id}"`)).includes(escape(words)), `checkbox describes ${id} and keeps its ID`);
          }
        }
        if (kind === "escaping") {
          assert.ok(cells[0].includes(escape("PM " + markup)));
          assert.ok(cells[2].includes(escape("Policy " + markup)));
          assert.ok(cells[1].includes(escape(newWords)) || cells[1].includes(escape(JSON.stringify(newWords))));
          assert.ok(!row.includes("<img"), "displayed model/user words cannot create elements");
          assert.equal((row.match(/name="radius"/g) ?? []).length, 2, "text cannot inject a checkbox");
        }
      } finally { await srv.close(); }
    });
    check(kind, true);
  } catch (e) { check(kind, false, e.stack); }
}
done();

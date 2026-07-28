#!/usr/bin/env node
/**
 * annotation ドメインの合成検体を作る。
 *
 * **なぜ合成が要るのか**: writer が作れる注釈は text / highlight / square の 3 種だけで、
 * Popup・Link・Screen・IRT/RT・複数ページ参照は writer の出力からは出てこない。
 * 実装由来の検体（`bad-annot-0.9.1` / `good-annot-0.16.0`）が「既知の正解ペア」を担い、
 * ここで作る合成検体が「制約 1 件ずつが本当に発火するか」を担う。
 *
 * 期待値は構築時に分かっている（どの制約を故意に破ったかを書いているのはこのファイル）。
 * 生成は決定論的（時刻を書かない）。
 *
 *   node scripts/gen-annotation-specimens.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFHexString } from 'pdf-lib';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** 外観ストリーム（Form XObject）を 1 つ作って ref を返す */
function appearanceStream(context, [w, h]) {
  return context.register(
    context.stream('0 0 0 RG 0.5 w 0 0 re S', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, w, h],
      Resources: context.obj({}),
    }),
  );
}

function annot(context, entries) {
  return context.register(context.obj({ Type: 'Annot', ...entries }));
}

async function build(kind) {
  const doc = await PDFDocument.create();
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const page1 = doc.addPage([595, 842]);
  const page2 = doc.addPage([595, 842]);
  const context = doc.context;
  const ap = (w, h) => context.obj({ N: appearanceStream(context, [w, h]) });

  const refs1 = [];
  const refs2 = [];

  if (kind === 'good') {
    // 1. 素直な Square。AP あり・C は DeviceRGB・F は Print のみ・NM は一意
    refs1.push(
      annot(context, {
        Subtype: 'Square',
        Rect: [72, 700, 200, 730],
        Contents: PDFHexString.fromText('boxed'),
        AP: ap(128, 30),
        C: [1, 0, 0],
        F: 4,
        // 標準ブレンドモード。CT-ANNOT-7 を pass 側でも 1 回通す（発火だけ見て終わらせない）
        BM: 'Multiply',
        NM: PDFHexString.fromText('a1'),
      }),
    );

    // 2. text markup。QuadPoints は条文どおり反時計回り（BL → BR → TR → TL）
    refs1.push(
      annot(context, {
        Subtype: 'Highlight',
        Rect: [72, 650, 300, 665],
        Contents: PDFHexString.fromText('paragraph one\rparagraph two'),
        AP: ap(228, 15),
        QuadPoints: [72, 650, 300, 650, 300, 665, 72, 665],
        NM: PDFHexString.fromText('a2'),
      }),
    );

    // 3. Link は AP 例外②。AP が無くても not_applicable になるべき
    refs1.push(
      annot(context, { Subtype: 'Link', Rect: [72, 600, 200, 615], NM: PDFHexString.fromText('a3') }),
    );

    // 4. 退化 Rect は AP 例外①（x1==x2 かつ y1==y2）
    refs1.push(
      annot(context, { Subtype: 'Text', Rect: [72, 580, 72, 580], NM: PDFHexString.fromText('a4') }),
    );

    // 5. markup + Popup。Popup は 6 で、5 から参照されている
    const popupRef = annot(context, {
      Subtype: 'Popup',
      Rect: [320, 640, 500, 720],
      NM: PDFHexString.fromText('a6'),
    });
    refs1.push(
      annot(context, {
        Subtype: 'Text',
        Rect: [72, 540, 92, 560],
        Contents: PDFHexString.fromText('note'),
        AP: ap(20, 20),
        Popup: popupRef,
        NM: PDFHexString.fromText('a5'),
      }),
    );
    refs1.push(popupRef);

    // 7 + 8. RT/IRT の対。IRT の相手は同じページ
    const primaryRef = annot(context, {
      Subtype: 'Text',
      Rect: [72, 500, 92, 520],
      Contents: PDFHexString.fromText('primary'),
      AP: ap(20, 20),
      NM: PDFHexString.fromText('a7'),
    });
    refs1.push(primaryRef);
    refs1.push(
      annot(context, {
        Subtype: 'Text',
        Rect: [72, 470, 92, 490],
        Contents: PDFHexString.fromText('reply'),
        AP: ap(20, 20),
        IRT: primaryRef,
        RT: 'Group',
        NM: PDFHexString.fromText('a8'),
      }),
    );

    // 9. AP に外観サブ辞書がある → AS が要る
    refs1.push(
      annot(context, {
        Subtype: 'Widget',
        Rect: [72, 430, 200, 450],
        AP: context.obj({ N: context.obj({ Off: appearanceStream(context, [128, 20]) }) }),
        AS: 'Off',
        NM: PDFHexString.fromText('a9'),
      }),
    );

    // 10. Screen + rendition action は /P が要る
    refs2.push(
      annot(context, {
        Subtype: 'Screen',
        Rect: [72, 700, 300, 800],
        AP: ap(228, 100),
        A: context.obj({ S: 'Rendition' }),
        P: page2.ref,
        NM: PDFHexString.fromText('b1'),
      }),
    );
  } else {
    // 故意の違反を 1 制約ずつ。番号は CT-ANNOT-* に対応する
    // CT-ANNOT-1: /Subtype と /Rect が無い
    refs1.push(annot(context, { Contents: PDFHexString.fromText('no subtype, no rect') }));

    // CT-ANNOT-2: /Type が Annot でない
    refs1.push(
      context.register(
        context.obj({ Type: 'Bogus', Subtype: 'Square', Rect: [72, 700, 200, 730], AP: ap(128, 30) }),
      ),
    );

    // CT-ANNOT-3 は実装由来の検体（bad-annot-0.9.1）が担うのでここでは作らない

    // CT-ANNOT-4: AP に外観サブ辞書があるのに /AS が無い
    refs1.push(
      annot(context, {
        Subtype: 'Widget',
        Rect: [72, 660, 200, 680],
        AP: context.obj({ N: context.obj({ Off: appearanceStream(context, [128, 20]) }) }),
      }),
    );

    // CT-ANNOT-5: markup の /Contents に単独 LF
    refs1.push(
      annot(context, {
        Subtype: 'Text',
        Rect: [72, 620, 92, 640],
        Contents: PDFHexString.fromText('line one\nline two'),
        AP: ap(20, 20),
      }),
    );

    // CT-ANNOT-6: /C の要素数が 2（色空間が決まらない）
    refs1.push(
      annot(context, { Subtype: 'Square', Rect: [72, 580, 200, 600], AP: ap(128, 20), C: [0.5, 0.5] }),
    );

    // CT-ANNOT-7: /BM が標準ブレンドモードでない
    refs1.push(
      annot(context, { Subtype: 'Square', Rect: [72, 540, 200, 560], AP: ap(128, 20), BM: 'Sepia' }),
    );

    // CT-ANNOT-8: /F に未定義ビット（bit 11 = 1024）
    refs1.push(
      annot(context, { Subtype: 'Square', Rect: [72, 500, 200, 520], AP: ap(128, 20), F: 1028 }),
    );

    // CT-ANNOT-9: QuadPoints が Z 順（= nonSimple）
    refs1.push(
      annot(context, {
        Subtype: 'Highlight',
        Rect: [72, 460, 300, 475],
        AP: ap(228, 15),
        QuadPoints: [72, 475, 300, 475, 72, 460, 300, 460],
      }),
    );

    // CT-ANNOT-10: 孤児の Popup（どの注釈からも参照されていない）
    refs1.push(annot(context, { Subtype: 'Popup', Rect: [320, 400, 500, 480] }));

    // CT-ANNOT-11: /RT があるのに /IRT が無い
    refs1.push(
      annot(context, {
        Subtype: 'Text',
        Rect: [72, 380, 92, 400],
        Contents: PDFHexString.fromText('reply without target'),
        AP: ap(20, 20),
        RT: 'Group',
      }),
    );

    // CT-ANNOT-13: 2 ページから参照される注釈
    const sharedRef = annot(context, {
      Subtype: 'Square',
      Rect: [72, 340, 200, 360],
      AP: ap(128, 20),
    });
    refs1.push(sharedRef);
    refs2.push(sharedRef);

    // CT-ANNOT-14: 同一ページで /NM が重複
    refs1.push(
      annot(context, {
        Subtype: 'Square',
        Rect: [72, 300, 200, 320],
        AP: ap(128, 20),
        NM: PDFHexString.fromText('dup'),
      }),
    );
    refs1.push(
      annot(context, {
        Subtype: 'Square',
        Rect: [72, 260, 200, 280],
        AP: ap(128, 20),
        NM: PDFHexString.fromText('dup'),
      }),
    );

    // CT-ANNOT-15: rendition action を持つ Screen に /P が無い
    refs1.push(
      annot(context, {
        Subtype: 'Screen',
        Rect: [320, 200, 500, 300],
        AP: ap(180, 100),
        A: context.obj({ S: 'Rendition' }),
      }),
    );

    // CT-ANNOT-12: /IRT の相手が別ページ（page1 の注釈を page2 の注釈が指す）
    const targetRef = annot(context, {
      Subtype: 'Text',
      Rect: [72, 220, 92, 240],
      Contents: PDFHexString.fromText('target on page 1'),
      AP: ap(20, 20),
    });
    refs1.push(targetRef);
    refs2.push(
      annot(context, {
        Subtype: 'Text',
        Rect: [72, 700, 92, 720],
        Contents: PDFHexString.fromText('reply from page 2'),
        AP: ap(20, 20),
        IRT: targetRef,
        RT: 'Group',
      }),
    );
  }

  page1.node.set(PDFName.of('Annots'), context.obj(refs1));
  page2.node.set(PDFName.of('Annots'), context.obj(refs2));

  const bytes = await doc.save({ useObjectStreams: false });
  const path = join(fixturesDir, `synthetic-annot-${kind}.pdf`);
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (page1: ${refs1.length} annots, page2: ${refs2.length})`);
}

await build('good');
await build('bad');

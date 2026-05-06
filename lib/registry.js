/**
 * registry.js — scan uploads/ and register any image folders that are
 * complete (have all 4 files + metadata) but not yet in the SQLite DB.
 *
 * Used both at server startup AND after every rclone copy, so newly
 * synced folders show up in the rater without needing a redeploy.
 *
 * Idempotent: relies on INSERT OR IGNORE — calling it repeatedly
 * never duplicates rows or alters existing ratings.
 */

import fs from 'fs';
import path from 'path';

const MORAN_SCORE = { 'Good': 4, 'Acceptable': 3, 'Risk': 2, 'Unacceptable': 1 };


export function registerAllImages(db, uploadsDir) {
  if (!fs.existsSync(uploadsDir)) {
    return { newImages: 0, sets: 0 };
  }

  const setDirs = fs.readdirSync(uploadsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  const insertSet    = db.prepare('INSERT OR IGNORE INTO image_sets (name) VALUES (?)');
  const getSet       = db.prepare('SELECT * FROM image_sets WHERE name = ?');
  const insertImage  = db.prepare(
    'INSERT OR IGNORE INTO images (set_id, filename, algorithm_score) VALUES (?, ?, ?)'
  );
  const updateScore  = db.prepare(
    'UPDATE images SET algorithm_score = ? WHERE set_id = ? AND filename = ? AND algorithm_score IS NULL'
  );

  let totalNew = 0;
  for (const setName of setDirs) {
    insertSet.run(setName);
    const set = getSet.get(setName);
    if (!set) continue;
    const setDir = path.join(uploadsDir, setName);

    const folders = fs.readdirSync(setDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    let added = 0;
    for (const folder of folders) {
      const folderPath = path.join(setDir, folder);
      const hasOriginal = fs.existsSync(path.join(folderPath, 'original.jpg'));
      const hasFpc      = fs.existsSync(path.join(folderPath, 'fpc_result.jpg'));
      const hasGrid     = fs.existsSync(path.join(folderPath, 'grid_overlay.jpg'));
      if (!hasOriginal || !hasFpc || !hasGrid) continue;

      const metaPath = path.join(folderPath, 'metadata.json');
      if (!fs.existsSync(metaPath)) continue;

      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
      catch { continue; }
      if (!meta.cv_rating && !meta.moran_rating_v2) continue;

      let algorithmScore = null;
      if (meta.algorithm_score != null) {
        algorithmScore = meta.algorithm_score;
      } else if (meta.set_type !== 'dqi' && meta.moran_rating_v2) {
        algorithmScore = MORAN_SCORE[meta.moran_rating_v2] ?? null;
      }

      const result = insertImage.run(set.id, folder, algorithmScore);
      if (result.changes > 0) {
        added++;
        if (algorithmScore !== null) {
          updateScore.run(algorithmScore, set.id, folder);
        }
      }
    }

    if (added > 0) {
      console.log(`[registry] +${added} new images registered in set "${setName}"`);
    }
    totalNew += added;
  }

  return { newImages: totalNew, sets: setDirs.length };
}

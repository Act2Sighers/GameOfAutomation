// ゲームデータ定義。設備・オブジェクト・加工レシピ・数値はすべてここで調整する。
window.GA = window.GA || {};

// 向き: 0=上 1=右 2=下 3=左
GA.DIRS = [
  { x: 0, y: -1, name: '上', arrow: '↑' },
  { x: 1, y: 0, name: '右', arrow: '→' },
  { x: 0, y: 1, name: '下', arrow: '↓' },
  { x: -1, y: 0, name: '左', arrow: '←' },
];

// レアリティ: 料理を食べたロボットが支払うローズ・トニックの量
GA.RARITIES = {
  common: { name: 'コモン', tonic: 1 },
};

// オブジェクト。category が 'dish' のものだけがレジャーシートで食べられる
GA.OBJECTS = {
  gomi: { name: 'ゴミ', category: 'material', desc: 'ガラクタの成れの果て。このままでは誰も食べない。' },
  gomidango: { name: 'ゴミダンゴ', category: 'dish', rarity: 'common', desc: 'ゴミを練って丸めたもの。最初の料理。' },
};

// 加工工程。recipes に無い入力は加工後に 'gomi' になる
GA.FALLBACK_OBJECT = 'gomi';
GA.PROCESSES = {
  neri: { name: '練り', recipes: { gomi: 'gomidango' } },
};

// 設備。kind は generator / conveyor / processor / storage / disposal / interior
// directional: 向きに意味がある設備。maxPlaced: 盤面に置ける上限。maxOwned: 所持できる上限（設置済み＋在庫）
// protected: この上のオブジェクトにはロボットが手を出さない
// conveyor の mode: simple = 一方向に流すだけ / junction = 分配・合流 / sorter = 仕分け
// conveyor の family: 系統（バケツ系・タイヤ系）。今は見た目と説明だけに使う
GA.EQUIPMENT = {
  gomi_container: {
    name: 'ゴミコンテナ', kind: 'generator', directional: true, produces: 'gomi', interval: 2.0, price: 15,
    desc: '向いている方向の隣マスが空いていれば「ゴミ」を生成する。',
  },
  bucket_conveyor: {
    name: 'バケツコンベア', kind: 'conveyor', mode: 'simple', family: 'bucket', directional: true, moveTime: 1.2, price: 2,
    desc: '乗ったオブジェクトを向いている方向へ運ぶ。遅い。分配・合流・仕分け機能なし。',
  },
  tire_conveyor: {
    name: 'タイヤコンベア', kind: 'conveyor', mode: 'junction', family: 'tire', directional: true, moveTime: 0.8, price: 5,
    desc: 'バケツより速いコンベア。複数の方向から合流でき、横や後ろに出ていくタイヤコンベアがあれば均等に分配する。',
  },
  tire_sorter: {
    name: '仕分けコンベア・タイヤ', kind: 'conveyor', mode: 'sorter', family: 'tire', directional: true, mirrorable: true,
    moveTime: 0.8, price: 12,
    desc: '比較マスにあるオブジェクトと同じものは仕分け先へ、違うもの（比較マスが空のときも）は本流の先へ流す。',
  },
  neriki: {
    name: '練り機', kind: 'processor', directional: true, process: 'neri', workTime: 2.0, outTime: 0.6, price: 10,
    desc: '中に入ったものを「練り」、向いている方向へ出す。練れないものはゴミになる。',
  },
  leisure_sheet: {
    name: 'レジャーシート', kind: 'storage', table: true, price: 6,
    desc: '食事テーブル。料理が乗るとロボットが食べに来る。',
  },
  basket: {
    name: 'バスケット', kind: 'storage', protected: true, price: 4,
    desc: '木編みの籠。上に乗ったものには何もしない。ロボットたちはこの上のものに手を出さない。',
  },
  shredder: {
    name: 'シュレッダー', kind: 'disposal', workTime: 1.0, price: 8,
    desc: '乗ったオブジェクトを少し時間をかけて消滅させる。',
  },
  kyakuyose_kanban: {
    name: '客寄せ看板', kind: 'interior', effect: 'attract', maxPlaced: 5, price: 20,
    desc: 'ロボットたちがこの看板の周りに集まり、看板のある側から来るようになる。看板の数だけ客が増える。',
  },
  koujichuu_kanban: {
    name: '工事中看板', kind: 'interior', effect: 'closed', maxOwned: 1, price: 1,
    desc: '置いてある間、ロボットたちは店に来なくなり、いた客もすぐに帰る。客寄せ看板より優先される。',
  },
};

// 旧バージョンの保存データにある設備名の読み替え
GA.LEGACY_TYPES = { sign: 'kyakuyose_kanban' };

// ショップに並ぶ順番
GA.SHOP_ORDER = ['gomi_container', 'bucket_conveyor', 'tire_conveyor', 'tire_sorter', 'neriki', 'leisure_sheet', 'basket', 'shredder', 'kyakuyose_kanban', 'koujichuu_kanban'];

GA.CONFIG = {
  gridW: 11,
  gridH: 9,
  border: 2,            // 画面上に描く外周のガラクタ山の厚さ（マス）
  testMode: true,       // テスト用: 初期トニック testTonic、メニューにトニック補充ボタン
  testTonic: 999,
  startTonic: 0,
  starterKit: { gomi_container: 1, bucket_conveyor: 6, neriki: 1, leisure_sheet: 1, shredder: 1, koujichuu_kanban: 1 },
  sellRate: 0.5,        // 売却価格 = 購入価格 × sellRate（切り捨て）
  simStep: 1 / 30,
  customer: {
    spawnInterval: [4, 8],   // 来店の間隔（秒、範囲内でランダム）。客寄せ看板の数で割る
    groupSize: [1, 2],       // 一度に来る数
    maxActive: 8,            // 同時に画面にいる上限。客寄せ看板の数を掛ける
    walkSpeed: 1.6,          // マス/秒
    patience: 7,             // 料理が無いときに看板の前で待つ秒数
    eatTime: 2.0,
    exitSpread: 2.5,         // 帰るときの出口のばらつき（マス）。辺に沿って左右にずらす幅
    exitBias: 1.5,           // 小さいほど一番近い辺から帰りやすい
  },
};

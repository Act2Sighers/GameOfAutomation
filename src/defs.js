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

// 設備。kind は generator / conveyor / processor / storage / disposal / sign
GA.EQUIPMENT = {
  gomi_container: {
    name: 'ゴミコンテナ', kind: 'generator', produces: 'gomi', interval: 2.0, price: 15,
    desc: '向いている方向の隣マスが空いていれば「ゴミ」を生成する。',
  },
  bucket_conveyor: {
    name: 'バケツコンベア', kind: 'conveyor', moveTime: 1.2, price: 2,
    desc: '乗ったオブジェクトを向いている方向へ運ぶ。遅い。分配・合流・仕分け機能なし。',
  },
  neriki: {
    name: '練り機', kind: 'processor', process: 'neri', workTime: 2.0, outTime: 0.6, price: 10,
    desc: '中に入ったものを「練り」、向いている方向へ出す。練れないものはゴミになる。',
  },
  leisure_sheet: {
    name: 'レジャーシート', kind: 'storage', table: true, price: 6,
    desc: '食事テーブル。料理が乗るとロボットが食べに来る。',
  },
  shredder: {
    name: 'シュレッダー', kind: 'disposal', workTime: 1.0, price: 8,
    desc: '乗ったオブジェクトを少し時間をかけて消滅させる。',
  },
  sign: {
    name: '「レストランOPEN」の看板', kind: 'sign', fixed: true, notForSale: true,
    desc: 'ガラクタ姫が拾ってきた看板。ロボットたちはまずここに集まる。',
  },
};

// ショップに並ぶ順番
GA.SHOP_ORDER = ['gomi_container', 'bucket_conveyor', 'neriki', 'leisure_sheet', 'shredder'];

GA.CONFIG = {
  gridW: 11,
  gridH: 9,
  border: 2,            // 画面上に描く外周のガラクタ山の厚さ（マス）
  startTonic: 0,
  starterKit: { gomi_container: 1, bucket_conveyor: 6, neriki: 1, leisure_sheet: 1, shredder: 1 },
  sellRate: 0.5,        // 売却価格 = 購入価格 × sellRate（切り捨て）
  simStep: 1 / 30,
  customer: {
    spawnInterval: [4, 8],   // 来店の間隔（秒、範囲内でランダム）
    groupSize: [1, 2],       // 一度に来る数
    maxActive: 8,            // 同時に画面にいる上限
    walkSpeed: 1.6,          // マス/秒
    patience: 7,             // 料理が無いときに看板の前で待つ秒数
    eatTime: 2.0,
  },
};

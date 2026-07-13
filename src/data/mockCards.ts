import type { Course, VocabCard } from '../types'

/**
 * MVP モックコース（リリース①候補）: 日本語 0→3k・メンバー向け・UI 英語・レール型。
 * ここは「モックデータの質」が命（Mock-First）。実在の N5 語・正しい読み・自然な例文を入れる。
 * 後で real（JMdict × wordfreq ja × Tatoeba × TTS の静的 JSON パック）に差し替える。
 */
export const mockCourse: Course = {
  id: 'ja-0-3k',
  title: 'Japanese 0 → 3,000',
  learningLanguage: 'Japanese',
  glossLanguage: 'English',
  uiLanguage: 'en',
  type: 'rail',
  band: { from: 0, to: 3000 },
}

type Seed = {
  headword: string
  reading: string
  gloss: string
  pos: string
  examples: [japanese: string, english: string][]
}

const seeds: Seed[] = [
  { headword: '水', reading: 'みず', gloss: 'water', pos: 'noun', examples: [['水を飲みます。', 'I drink water.'], ['この水はつめたい。', 'This water is cold.']] },
  { headword: '火', reading: 'ひ', gloss: 'fire', pos: 'noun', examples: [['火をつけます。', 'I light a fire.'], ['火はあぶないです。', 'Fire is dangerous.']] },
  { headword: '山', reading: 'やま', gloss: 'mountain', pos: 'noun', examples: [['山に登ります。', 'I climb the mountain.'], ['あの山は高い。', 'That mountain is tall.']] },
  { headword: '川', reading: 'かわ', gloss: 'river', pos: 'noun', examples: [['川で泳ぎます。', 'I swim in the river.'], ['この川はきれいだ。', 'This river is clean.']] },
  { headword: '空', reading: 'そら', gloss: 'sky', pos: 'noun', examples: [['空が青い。', 'The sky is blue.'], ['空に鳥がいる。', 'There is a bird in the sky.']] },
  { headword: '海', reading: 'うみ', gloss: 'sea', pos: 'noun', examples: [['夏に海へ行きます。', 'I go to the sea in summer.'], ['海が見えます。', 'I can see the sea.']] },
  { headword: '人', reading: 'ひと', gloss: 'person', pos: 'noun', examples: [['あの人はだれですか。', 'Who is that person?'], ['人が多いです。', 'There are many people.']] },
  { headword: '本', reading: 'ほん', gloss: 'book', pos: 'noun', examples: [['本を読みます。', 'I read a book.'], ['この本はおもしろい。', 'This book is interesting.']] },
  { headword: '車', reading: 'くるま', gloss: 'car', pos: 'noun', examples: [['車を運転します。', 'I drive a car.'], ['車で行きます。', 'I go by car.']] },
  { headword: '家', reading: 'いえ', gloss: 'house, home', pos: 'noun', examples: [['家に帰ります。', 'I return home.'], ['大きい家ですね。', "It's a big house, isn't it?"]] },
  { headword: '学校', reading: 'がっこう', gloss: 'school', pos: 'noun', examples: [['学校へ行きます。', 'I go to school.'], ['学校は楽しい。', 'School is fun.']] },
  { headword: '先生', reading: 'せんせい', gloss: 'teacher', pos: 'noun', examples: [['先生に聞きます。', 'I ask the teacher.'], ['田中先生はやさしい。', 'Mr. Tanaka is kind.']] },
  { headword: '学生', reading: 'がくせい', gloss: 'student', pos: 'noun', examples: [['私は学生です。', 'I am a student.'], ['学生が三人います。', 'There are three students.']] },
  { headword: '友達', reading: 'ともだち', gloss: 'friend', pos: 'noun', examples: [['友達と話します。', 'I talk with my friend.'], ['友達ができました。', 'I made a friend.']] },
  { headword: '時間', reading: 'じかん', gloss: 'time, hour', pos: 'noun', examples: [['時間がありません。', "I don't have time."], ['三時間勉強しました。', 'I studied for three hours.']] },
  { headword: '今日', reading: 'きょう', gloss: 'today', pos: 'noun', examples: [['今日はいい天気です。', 'Today is nice weather.'], ['今日会いましょう。', "Let's meet today."]] },
  { headword: '明日', reading: 'あした', gloss: 'tomorrow', pos: 'noun', examples: [['明日来ます。', 'I will come tomorrow.'], ['明日は休みです。', 'Tomorrow is a day off.']] },
  { headword: '食べる', reading: 'たべる', gloss: 'to eat', pos: 'verb', examples: [['ご飯を食べる。', 'I eat a meal.'], ['何を食べますか。', 'What will you eat?']] },
  { headword: '飲む', reading: 'のむ', gloss: 'to drink', pos: 'verb', examples: [['お茶を飲む。', 'I drink tea.'], ['薬を飲みました。', 'I took (drank) medicine.']] },
  { headword: '見る', reading: 'みる', gloss: 'to see, to watch', pos: 'verb', examples: [['テレビを見る。', 'I watch TV.'], ['写真を見ました。', 'I looked at the photos.']] },
  { headword: '聞く', reading: 'きく', gloss: 'to listen, to ask', pos: 'verb', examples: [['音楽を聞く。', 'I listen to music.'], ['道を聞きます。', 'I ask for directions.']] },
  { headword: '話す', reading: 'はなす', gloss: 'to speak, to talk', pos: 'verb', examples: [['日本語を話す。', 'I speak Japanese.'], ['ゆっくり話してください。', 'Please speak slowly.']] },
  { headword: '読む', reading: 'よむ', gloss: 'to read', pos: 'verb', examples: [['新聞を読む。', 'I read the newspaper.'], ['本を読みました。', 'I read a book.']] },
  { headword: '書く', reading: 'かく', gloss: 'to write', pos: 'verb', examples: [['名前を書く。', 'I write my name.'], ['手紙を書きました。', 'I wrote a letter.']] },
  { headword: '行く', reading: 'いく', gloss: 'to go', pos: 'verb', examples: [['会社へ行く。', 'I go to the office.'], ['どこへ行きますか。', 'Where are you going?']] },
  { headword: '来る', reading: 'くる', gloss: 'to come', pos: 'verb', examples: [['友達が来る。', 'My friend is coming.'], ['また来てください。', 'Please come again.']] },
  { headword: '帰る', reading: 'かえる', gloss: 'to return, to go home', pos: 'verb', examples: [['家に帰る。', 'I go home.'], ['もう帰ります。', "I'm going home now."]] },
  { headword: '買う', reading: 'かう', gloss: 'to buy', pos: 'verb', examples: [['パンを買う。', 'I buy bread.'], ['何を買いましたか。', 'What did you buy?']] },
  { headword: '大きい', reading: 'おおきい', gloss: 'big, large', pos: 'い-adjective', examples: [['大きい犬です。', "It's a big dog."], ['この町は大きい。', 'This town is big.']] },
  { headword: '小さい', reading: 'ちいさい', gloss: 'small, little', pos: 'い-adjective', examples: [['小さい子どもです。', "It's a small child."], ['声が小さいです。', 'Your voice is quiet.']] },
  { headword: '新しい', reading: 'あたらしい', gloss: 'new', pos: 'い-adjective', examples: [['新しい車がほしい。', 'I want a new car.'], ['この店は新しい。', 'This shop is new.']] },
  { headword: '古い', reading: 'ふるい', gloss: 'old (things)', pos: 'い-adjective', examples: [['古い建物です。', "It's an old building."], ['この本は古い。', 'This book is old.']] },
  { headword: '高い', reading: 'たかい', gloss: 'tall, expensive', pos: 'い-adjective', examples: [['この時計は高い。', 'This watch is expensive.'], ['高い山に登る。', 'I climb a tall mountain.']] },
  { headword: '安い', reading: 'やすい', gloss: 'cheap, inexpensive', pos: 'い-adjective', examples: [['この店は安い。', 'This shop is cheap.'], ['安い物を買いました。', 'I bought a cheap item.']] },
  { headword: '暑い', reading: 'あつい', gloss: 'hot (weather)', pos: 'い-adjective', examples: [['今日は暑い。', 'Today is hot.'], ['夏は暑いです。', 'Summer is hot.']] },
  { headword: '寒い', reading: 'さむい', gloss: 'cold (weather)', pos: 'い-adjective', examples: [['冬は寒い。', 'Winter is cold.'], ['今日は寒いですね。', "It's cold today, isn't it?"]] },
  { headword: '楽しい', reading: 'たのしい', gloss: 'fun, enjoyable', pos: 'い-adjective', examples: [['旅行は楽しい。', 'Travel is fun.'], ['楽しい一日でした。', 'It was a fun day.']] },
  { headword: '難しい', reading: 'むずかしい', gloss: 'difficult', pos: 'い-adjective', examples: [['この問題は難しい。', 'This problem is difficult.'], ['日本語は難しいですか。', 'Is Japanese difficult?']] },
  { headword: 'いい', reading: 'いい', gloss: 'good, nice', pos: 'い-adjective', examples: [['いい天気ですね。', "Nice weather, isn't it?"], ['それはいい考えです。', "That's a good idea."]] },
  { headword: '犬', reading: 'いぬ', gloss: 'dog', pos: 'noun', examples: [['犬が好きです。', 'I like dogs.'], ['犬と散歩します。', 'I walk with my dog.']] },
  { headword: '猫', reading: 'ねこ', gloss: 'cat', pos: 'noun', examples: [['猫がいます。', 'There is a cat.'], ['白い猫です。', "It's a white cat."]] },
  { headword: '花', reading: 'はな', gloss: 'flower', pos: 'noun', examples: [['花がきれいです。', 'The flowers are beautiful.'], ['花を買いました。', 'I bought flowers.']] },
  { headword: '木', reading: 'き', gloss: 'tree, wood', pos: 'noun', examples: [['大きい木があります。', 'There is a big tree.'], ['木の下にいます。', "I'm under the tree."]] },
  { headword: '雨', reading: 'あめ', gloss: 'rain', pos: 'noun', examples: [['雨が降ります。', 'It rains.'], ['明日は雨です。', 'Tomorrow is rainy.']] },
  { headword: '雪', reading: 'ゆき', gloss: 'snow', pos: 'noun', examples: [['雪が降る。', 'It snows.'], ['雪は白い。', 'Snow is white.']] },
  { headword: '朝', reading: 'あさ', gloss: 'morning', pos: 'noun', examples: [['朝早く起きます。', 'I get up early in the morning.'], ['朝ごはんを食べます。', 'I eat breakfast.']] },
  { headword: '夜', reading: 'よる', gloss: 'night', pos: 'noun', examples: [['夜に寝ます。', 'I sleep at night.'], ['夜は静かです。', 'The night is quiet.']] },
  { headword: '名前', reading: 'なまえ', gloss: 'name', pos: 'noun', examples: [['名前を教えてください。', 'Please tell me your name.'], ['私の名前は田中です。', 'My name is Tanaka.']] },
  { headword: '電話', reading: 'でんわ', gloss: 'telephone, phone call', pos: 'noun', examples: [['電話をします。', 'I make a phone call.'], ['電話が鳴りました。', 'The phone rang.']] },
  { headword: 'お金', reading: 'おかね', gloss: 'money', pos: 'noun', examples: [['お金がありません。', 'I have no money.'], ['お金を払います。', 'I pay money.']] },
]

export const mockCards: VocabCard[] = seeds.map((s, i) => ({
  id: `ja-0-3k-${String(i + 1).padStart(3, '0')}`,
  courseId: 'ja-0-3k',
  headword: s.headword,
  reading: s.reading,
  gloss: s.gloss,
  pos: s.pos,
  examples: s.examples.map(([text, translation]) => ({ text, translation })),
  frequencyRank: i + 1,
  jlptLevel: 'N5',
}))

import { Data, Entry, uid } from "./types";
// Authored starter vocabulary, no simulated learning history. Not an official CET-4 list.
const nouns = `campus|校园|大学生活
library|图书馆|大学生活
lecture|讲座|大学生活
semester|学期|大学生活
scholarship|奖学金|大学生活
assignment|作业|大学生活
laboratory|实验室|大学生活
dormitory|宿舍|大学生活
curriculum|课程体系|大学生活
certificate|证书|大学生活
heritage|遗产|传统文化
tradition|传统|传统文化
festival|节日|传统文化
ceremony|典礼|传统文化
calligraphy|书法|传统文化
poetry|诗歌|传统文化
porcelain|瓷器|传统文化
dynasty|朝代|传统文化
architecture|建筑学|传统文化
custom|习俗|传统文化
opportunity|机会
challenge|挑战
evidence|证据
environment|环境
resource|资源
community|社区
knowledge|知识
experience|经验
responsibility|责任
achievement|成就
advantage|优势
behavior|行为
confidence|信心
decision|决定
education|教育
effort|努力
influence|影响
method|方法
purpose|目的
quality|质量
research|研究
solution|解决办法
technology|技术
balance|平衡
budget|预算
career|职业
competition|竞争
consequence|后果
contribution|贡献
courage|勇气
demand|需求
detail|细节
economy|经济
energy|能量
equipment|设备
freedom|自由
friendship|友谊
growth|增长
health|健康
income|收入
industry|工业
information|信息
inspiration|灵感
instruction|指令
interest|兴趣
journey|旅程
language|语言
leadership|领导力
literature|文学
memory|记忆
motivation|动力
nutrition|营养
opinion|意见
organization|组织
patience|耐心
performance|表现
permission|许可
population|人口
pressure|压力
priority|优先事项
progress|进步
relationship|关系
reputation|声誉
schedule|时间表
security|安全保障
skill|技能
society|社会
strategy|策略
strength|力量
success|成功
support|支持
transport|运输
value|价值
variety|多样性
volunteer|志愿者
wealth|财富
wisdom|智慧
identity|身份
communication|交流
creativity|创造力`;
const others = `adapt|适应|v.
analyze|分析|v.
appreciate|欣赏|v.
benefit|受益|v.
concentrate|专注|v.
develop|发展|v.
encourage|鼓励|v.
improve|改善|v.
maintain|维持|v.
participate|参与|v.
achieve|实现|v.
protect|保护|v.
confident|自信的|adj.
essential|必不可少的|adj.
independent|独立的|adj.
effective|有效的|adj.
curious|好奇的|adj.
responsible|负责任的|adj.
flexible|灵活的|adj.
available|可获得的|adj.`;
export function addDemo(d: Data) {
  if (d.decks.some((x) => x.id === "demo-starter"))
    throw Error("示例词库已经存在");
  d.decks.push({
    id: "demo-starter",
    name: "四级起步 · 示例词库",
    author: "词间",
    version: "1.0",
    language: "en",
    source: "人工编写的功能演示词条，非官方四级完整词表",
    license: "CC0",
    tags: ["四级", "大学生活", "传统文化"],
    demo: true,
  });
  const rows = [
    ...nouns.split("\n").map((r) => {
      const [word, zh, tag] = r.split("|");
      return { word, zh, pos: "n.", tag };
    }),
    ...others.split("\n").map((r) => {
      const [word, zh, pos] = r.split("|");
      return { word, zh, pos, tag: "" };
    }),
  ];
  for (const row of rows) {
    let e = d.entries.find(
      (e) => e.word === row.word && e.senses[0].zh === row.zh,
    );
    if (!e) {
      e = {
        id: "starter:" + row.word,
        word: row.word,
        phonetic: "",
        phrase: "",
        tags: ["四级", ...(row.tag ? [row.tag] : [])],
        senses: [
          {
            id: row.word + ":s1",
            pos: row.pos,
            zh: row.zh,
            acceptedZh: [],
            variants: [],
            examples: [],
          },
        ],
      };
      if (row.word === "heritage") {
        e.phonetic = "/ˈherɪtɪdʒ/";
        e.phrase = "cultural heritage · 文化遗产";
        e.senses[0].examples = [
          {
            id: "heritage:ex",
            en: "We should protect our cultural heritage.",
            zh: "我们应该保护文化遗产。",
          },
        ];
      }
      if (row.word === "campus") {
        e.phonetic = "/ˈkæmpəs/";
        e.phrase = "on campus · 在校园里";
        e.senses[0].examples = [
          {
            id: "campus:ex",
            en: "There is a quiet garden on campus.",
            zh: "校园里有一座安静的花园。",
          },
        ];
      }
      d.entries.push(e);
    }
    d.links.push({ deckId: "demo-starter", entryId: e.id });
  }
}

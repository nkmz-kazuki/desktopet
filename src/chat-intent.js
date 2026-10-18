(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.chatIntent = factory();
})(globalThis, () => {
  function isTimeQuestion(message) {
    const question = String(message || '').replace(/[\s，,。.!！?？]/gu, '')
      .replace(/^(?:请问|请告诉我|告诉我|帮我看一下|帮我看看|麻烦告诉我)/u, '');
    return /^(?:(?:现在|当前|今天|此刻)(?:是)?)?(?:几点(?:了)?|(?:什么)?时间|时间(?:是(?:什么|多少))?|日期(?:是(?:什么|多少))?|星期几|周几|几号|几月几号)$/u.test(question);
  }

  function isWeatherQuestion(message, city = '') {
    let question = String(message || '').replace(/[\s，,。.!！?？]/gu, '')
      .replace(/^(?:请问|请告诉我|告诉我|帮我看一下|帮我看看)/u, '');
    const currentTime = /^(?:现在|当前|今天|今日|本地|这里|这儿)(?:的)?/u;
    question = question.replace(currentTime, '');
    if (city && question.startsWith(city.trim())) question = question.slice(city.trim().length);
    question = question.replace(currentTime, '').replace(/(?:呢|吗|么)$/u, '');
    return /^(?:天气(?:怎么样|如何|怎样|好不好|情况|预报)?|(?:气温|温度)(?:是)?(?:多少度?|几度|怎么样)?|(?:会不会|是否会|是否|会|要)?下雨|(?:要不要|需要|用不用)?带伞)$/u.test(question);
  }

  function requiresWebSearch(message) {
    const text = String(message || '');
    const unquoted = text.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/g, '');
    if (/https?:\/\/|\b(?:search|browse|look\s+up|verify)\b|搜索|搜一下|搜一搜|查一下|查一查|查查|查询|检索|查阅|查资料|查找|帮我查|上网|联网|核实|核查|寻找来源|提供来源|注明来源|核对来源/i.test(unquoted)) return true;
    if (/^(?:请|帮我|请帮我)?(?:把.+(?:翻译|润色|改写)|翻译|润色|改写|校对|总结(?:以下|这段|所给|下面)|分析.+语法|讲解.+时|解释[“「『"'])/u.test(text.trim())) return false;
    return /网上|网页|网址|链接|来源|出处|新闻|天气|气温|预报|最新|最近|近期|目前|现在|当前|今年|本年|本月|本周|今天|今日|昨天|昨日|刚刚|刚发布|实时|现任|获奖|诺贝尔|诺奖|价格|报价|股价|汇率|20\d{2}|https?:\/\/|\b(?:latest|current|today|this\s+year|news)\b/i.test(text);
  }

  return { isTimeQuestion, isWeatherQuestion, requiresWebSearch };
});

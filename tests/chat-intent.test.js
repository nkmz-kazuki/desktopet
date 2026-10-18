const test = require('node:test');
const assert = require('node:assert/strict');
const { isTimeQuestion, isWeatherQuestion, requiresWebSearch } = require('../src/chat-intent');

test('local clock only answers direct clock or calendar questions', () => {
  for (const question of ['现在几点？', '日期是什么？', '请问今天星期几？', '当前时间', '现在是什么时间', '今天几号？']) {
    assert.equal(isTimeQuestion(question), true, question);
  }
  for (const question of ['今年诺贝尔奖颁奖时间是什么？', '网页发布日期是哪天？', '解释时间复杂度', '时间管理有什么建议？', '星期一之后的历史事件']) {
    assert.equal(isTimeQuestion(question), false, question);
  }
});

test('fresh or explicitly requested facts require real retrieval while casual companionship does not', () => {
  for (const question of ['一句话概括今年生物学诺奖的主题', '搜索 Python 官方文档', '查一下最近的新闻', '2026年诺贝尔奖颁奖日期', 'https://example.com 的内容是什么', 'latest astronomy news']) {
    assert.equal(requiresWebSearch(question), true, question);
  }
  for (const question of ['你好，陪我聊聊', '给我讲个小故事', '解释递归的基本原理']) {
    assert.equal(requiresWebSearch(question), false, question);
  }
});

test('supplied text and grammar exercises do not trigger searches merely because they mention recency', () => {
  for (const question of ['把“今年诺贝尔奖的主题”翻译成英文', '润色这句话：今年我想学编程', '总结以下文字：今天我们学习编程', '请分析“今年该怎么学习”这句话的语法', '讲解现在完成时', '解释“最新”这个词的意思', '翻译“请上网查询最新新闻”']) {
    assert.equal(requiresWebSearch(question), false, question);
  }
  for (const question of ['翻译今天诺奖相关新闻，并核实来源', '查一下今年诺奖并用英语总结', '总结 https://example.com 的最新文章']) {
    assert.equal(requiresWebSearch(question), true, question);
  }
});

test('weather shortcut only handles current local conditions, never research, other cities or future forecasts', () => {
  for (const question of ['今日天气如何？', '今天北京天气', '北京今天气温几度？', '现在温度是多少度？', '今天会下雨吗？', '要不要带伞？']) {
    assert.equal(isWeatherQuestion(question, '北京'), true, question);
  }
  for (const question of ['查询全球平均气温最新研究', '搜索量子计算机工作温度', '查一下明天东京天气', '上海天气', '明天天气预报', '解释温度的物理意义']) {
    assert.equal(isWeatherQuestion(question, '北京'), false, question);
  }
  for (const question of ['上海天气', '明天天气预报', '查询全球平均气温最新研究']) assert.equal(requiresWebSearch(question), true, question);
});

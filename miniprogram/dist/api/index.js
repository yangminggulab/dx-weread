"use strict";

const {
  BASE_URL,
  API_TOKEN
} = require('../config');
const {
  createDiaryWriter
} = require("../utils/diary-sync.js");

// 小程序固定走个人版 /tasks + API_TOKEN。

const diaryWriter = createDiaryWriter(payload => request('/api/diary', 'POST', payload), operation => request('/api/diary/sync', 'POST', operation));
function request(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method,
      data: data || undefined,
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_TOKEN}`
      },
      success: res => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          const error = new Error(res.statusCode === 401 ? '认证失败，请检查 API Token' : `请求失败: ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.today = res.data && res.data.today;
          reject(error);
        }
      },
      fail: err => reject(err)
    });
  });
}

// 获取全部数据
const getData = () => request('/api/data');
const getSyncState = () => request('/api/sync-state');

// 保存全部数据
const saveData = data => request('/api/data', 'POST', data);

// 新增任务
const addTask = task => request('/api/tasks/add', 'POST', task).then(receipt => {
  var _receipt$task;
  if (!(receipt !== null && receipt !== void 0 && receipt.ok) || !Number.isSafeInteger((_receipt$task = receipt.task) === null || _receipt$task === void 0 ? void 0 : _receipt$task.id)) throw new Error('云端没有确认新增任务');
  return receipt;
});

// 更新任务
const updateTask = task => request('/api/tasks/update', 'POST', task).then(receipt => {
  var _receipt$task2;
  if (!(receipt !== null && receipt !== void 0 && receipt.ok) || ((_receipt$task2 = receipt.task) === null || _receipt$task2 === void 0 ? void 0 : _receipt$task2.id) !== task.id) throw new Error('云端没有确认任务更新');
  return receipt;
});

// 删除任务
const deleteTask = id => request('/api/tasks/delete', 'POST', {
  id
});

// 获取日记（今日 + 归档）
const getDiary = () => request('/api/diary');

// 仅获取今日日记（轻量，启动时用）
const getDiaryToday = () => request('/api/diary?today=1');

// 保存日记：串行发送，避免多个页面/定时器同时写 diary_data 时互相覆盖。
const saveDiary = diary => diaryWriter.save(diary);

// 页面切换后读取日记前，等待离页触发的保存完成，避免 GET 抢在 POST 前返回旧数据。
const syncDiaryEntry = operation => diaryWriter.sync(operation);
const getDiaryVersions = (date, cursor) => request(`/api/diary/versions?date=${encodeURIComponent(date)}${cursor ? `&cursor=${cursor}` : ''}`);
const waitForDiarySaves = () => diaryWriter.wait();

// 新增笔记（原子接口，不影响任务数据）
const addNote = note => request('/api/notes/add', 'POST', note);

// 删除笔记（原子接口）
const deleteNote = id => request('/api/notes/delete', 'POST', {
  id
});

// 更新笔记（原子接口）
const updateNote = note => request('/api/notes/update', 'POST', note);

// 年度总结与长篇思想（独立云端库 essays_data，原子接口）
const getEssays = () => request('/api/essays');
const addEssay = essay => request('/api/essays/add', 'POST', essay);
const updateEssay = essay => request('/api/essays/update', 'POST', essay);
const deleteEssay = id => request('/api/essays/delete', 'POST', {
  id
});

// Advance only through this process's confirmed writes, including page re-entry.
const diarySaveBaseline = (date, version) => diaryWriter.resolveBaseline(date, version);
module.exports = {
  getData,
  getSyncState,
  saveData,
  addTask,
  updateTask,
  deleteTask,
  getDiary,
  getDiaryToday,
  saveDiary,
  syncDiaryEntry,
  getDiaryVersions,
  waitForDiarySaves,
  addNote,
  deleteNote,
  updateNote,
  getEssays,
  addEssay,
  updateEssay,
  deleteEssay,
  diarySaveBaseline
};

export default defineAppConfig({
  pages: [
    'pages/index/index',
    'pages/books/index',
    'pages/notes/index'
  ],
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#2d6a4f',
    navigationBarTitleText: '任务管理',
    navigationBarTextStyle: 'white',
    backgroundColor: '#f7f5f0'
  },
  tabBar: {
    color: '#888',
    selectedColor: '#2d6a4f',
    backgroundColor: '#ffffff',
    borderStyle: 'white',
    list: [
      {
        pagePath: 'pages/index/index',
        text: '任务',
        iconPath: 'assets/icons/task.png',
        selectedIconPath: 'assets/icons/task_active.png'
      },
      {
        pagePath: 'pages/books/index',
        text: '书单',
        iconPath: 'assets/icons/book.png',
        selectedIconPath: 'assets/icons/book_active.png'
      },
      {
        pagePath: 'pages/notes/index',
        text: '笔记',
        iconPath: 'assets/icons/note.png',
        selectedIconPath: 'assets/icons/note_active.png'
      }
    ]
  }
})

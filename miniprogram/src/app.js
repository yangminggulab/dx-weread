import { Component } from 'react'
import './app.scss'

class App extends Component {
  onLaunch() {}
  render() {
    return this.props.children
  }
}

export default App

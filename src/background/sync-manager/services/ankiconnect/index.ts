/* eslint-disable new-cap */
/* eslint-disable no-undef */
import axios from 'axios'
import { Word } from '@/_helpers/record-manager'
import { parseCtxText } from '@/_helpers/translateCtx'
import { AddConfig, SyncService } from '../../interface'
import { getNotebook } from '../../helpers'
import { message } from '@/_helpers/browser-api'
import { Message } from '@/typings/message'
import { YoudaoEN_T_ZH } from './youdao_pronunce'

export interface SyncConfig {
  enable: boolean
  key: string | null
  host: string
  port: string
  deckName: string
  noteType: string
  /** Note tags */
  tags: string
  escapeContext: boolean
  escapeTrans: boolean
  escapeNote: boolean
  /** Sync to AnkiWeb after added */
  syncServer: boolean
}

export class Service extends SyncService<SyncConfig> {
  static readonly id = 'ankiconnect'

  static getDefaultConfig(): SyncConfig {
    return {
      enable: false,
      host: '127.0.0.1',
      port: '8765',
      key: null,
      deckName: '英语',
      noteType: '单词',
      tags: '',
      escapeContext: true,
      escapeTrans: true,
      escapeNote: true,
      syncServer: false
    }
  }

  noteFileds: string[] | undefined

  async init() {
    if (!(await this.isServerUp())) {
      throw new Error('server')
    }

    const decks = await this.request<string[]>('deckNames')
    if (!decks?.includes(this.config.deckName)) {
      throw new Error('deck')
    }

    const noteTypes = await this.request<string[]>('modelNames')
    if (!noteTypes?.includes(this.config.noteType)) {
      throw new Error('notetype')
    }
    console.log('init success')
  }

  handleMessage = (msg: Message) => {
    switch (msg.type) {
      case 'ANKI_CONNECT_FIND_WORD':
        return this.findNote(msg.payload).catch(() => '')
      case 'ANKI_CONNECT_UPDATE_WORD':
        return this.updateWord(msg.payload.cardId, msg.payload.word).catch(e =>
          Promise.reject(e)
        )
    }
  }

  onStart() {
    message.addListener(this.handleMessage)
  }

  async destroy() {
    message.removeListener(this.handleMessage)
  }

  async findNote(date: number): Promise<number | undefined> {
    if (!this.noteFileds) {
      this.noteFileds = await this.getNotefields()
    }
    try {
      const notes = await this.request<number[]>('findNotes', {
        query: `deck:${this.config.deckName} ${this.noteFileds[7]}:${date}`
      })
      return notes[0]
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(e)
      }
    }
  }

  async add({ words, force }: AddConfig) {
    if (!(await this.isServerUp())) {
      throw new Error('server')
    }

    if (force) {
      words = await getNotebook()
      console.log(words)
    }

    if (!words || words.length <= 0) {
      return
    }

    await Promise.all(
      words.map(async word => {
        if (!(await this.findNote(word.date))) {
          try {
            await this.addWord(word)
          } catch (e) {
            if (process.env.DEBUG) {
              console.warn(e)
            }
            throw new Error('add')
          }
        }
      })
    )

    if (this.config.syncServer) {
      try {
        await this.request('sync')
      } catch (e) {
        if (process.env.DEBUG) {
          console.warn(e)
        }
      }
    }
  }

  async addWord(word: Readonly<Word>) {
    const pronouce_set = await new YoudaoEN_T_ZH().translate({
      queryWord: word.text,
      sourceLang: 'en',
      targetLang: 'zh'
    })

    if (pronouce_set) {
      const requestParams = {
        note: {
          deckName: this.config.deckName,
          modelName: this.config.noteType,
          options: {
            allowDuplicate: false,
            duplicateScope: 'deck'
          },
          tags: this.extractTags(),
          fields: {
            ...(await this.wordToFields(word)),
            Paraphrase: pronouce_set.paraphrase.main_paraphrase.paraphrase.join(
              '\n'
            ),
            Pronounce: `[sound:${word.text}.mp3]`,
            Phonetic: pronouce_set?.pronounce
              .map(p => {
                return p.name + p.phonetic
              })
              .join()
          },
          audio: [
            {
              url: pronouce_set?.pronounce[0].voiceLink,
              filename: `${word.text}.mp3`,
              skipHash: '7e2c2f954ef6051373ba916f000168dc',
              fields: ['Pronunce']
            }
          ]
        }
      }
      console.log('requestParams', requestParams)
      return this.request<number | null>('addNote', requestParams)
    }
  }

  async updateWord(noteId: number, word: Readonly<Word>) {
    return this.request('updateNoteFields', {
      note: {
        id: noteId,
        fields: await this.wordToFields(word)
      }
    })
  }

  async addDeck() {
    return this.request('createDeck', { deck: this.config.deckName })
  }

  async addNoteType() {
    this.noteFileds = [
      'Text',
      'Phonetic',
      'Context',
      'Paraphrase',
      'Translation',
      'Pronounce',
      'url',
      'Date'
    ]

    await this.request('createModel', {
      modelName: this.config.noteType,
      inOrderFields: this.noteFileds,
      css: cardCss(),
      cardTemplates: [
        {
          Name: 'Saladict Cloze',
          Front: cardText(true, this.noteFileds),
          Back: cardText(false, this.noteFileds)
        }
      ]
    })

    // Anki Connect could tranlate the field names
    // Update again
    this.noteFileds = await this.getNotefields()
    await this.request('updateModelTemplates', {
      model: {
        name: this.config.noteType,
        templates: {
          'Saladict Cloze': {
            Front: cardText(true, this.noteFileds),
            Back: cardText(false, this.noteFileds)
          }
        }
      }
    })
  }

  async request<R = void>(action: string, params?: any): Promise<R> {
    const { data } = await axios({
      method: 'post', // anki同步
      url: `http://${this.config.host}:${this.config.port}`,
      data: {
        key: this.config.key || null,
        version: 6,
        action,
        params: params || {}
      }
    })
    console.log('params', params)
    console.log('restult', data)

    if (process.env.DEBUG) {
      console.log(`Anki Connect ${action} response`, data)
    }

    if (!data || !Object.prototype.hasOwnProperty.call(data, 'result')) {
      throw new Error('Deprecated Anki Connect version')
    }

    if (data.error) {
      throw new Error(data.error)
    }

    return data.result
  }

  async wordToFields(word: Readonly<Word>): Promise<{ [k: string]: string }> {
    if (!this.noteFileds) {
      this.noteFileds = await this.getNotefields()
    }

    const pronouce_set = await new YoudaoEN_T_ZH().translate({
      queryWord: word.text,
      sourceLang: 'en',
      targetLang: 'zh'
    })
    console.log('wordField:', this.noteFileds, word)
    // console.log('youdao:', pronouce_set)
    return {
      // word
      [this.noteFileds[0]]: `${word.text}`,
      // phonic
      [this.noteFileds[1]]: `${pronouce_set?.pronounce.map(p => {
        return p.name + p.phonetic
      })}`,
      // context
      [this.noteFileds[2]]:
        this.multiline(
          word.context.split(word.text).join(`<b>${word.text}</b>`),
          this.config.escapeContext
        ) || `<b>${word.text}</b>`,
      // Translation
      [this.noteFileds[4]]: word.trans,
      // Context
      // [this.noteFileds[2]]: this.multiline(
      //   word.context,
      //   this.config.escapeContext
      // ),
      // ContextCloze
      // Note
      // [this.noteFileds[5]]: this.multiline(word.note, this.config.escapeNote),
      // Title
      // Url
      [this.noteFileds[6]]: word.url || '',
      [this.noteFileds[7]]: `${word.date}`
      // Favicon
      // [this.noteFileds[8]]: word.favicon || '',
      // Audio
      // [this.noteFileds[9]]: '' // @TODO
    }
  }

  async getNotefields(): Promise<string[]> {
    return [
      'Text',
      'Phonetic',
      'Context',
      'Paraphrase',
      'Translation',
      'Pronounce',
      'url',
      'Date'
    ]
    // const nf = await this.request<string[]>('modelFieldNames', {
    //   modelName: this.config.noteType
    // })

    // // Anki connect bug
    // return nf?.includes('Date.')
    //   ? [
    //       'Date.',
    //       'Text.',
    //       'Translation.',
    //       'Context.',
    //       'ContextCloze.',
    //       'Note.',
    //       'Title.',
    //       'Url.',
    //       'Favicon.',
    //       'Audio.'
    //     ]
    //   : nf?.includes('日期')
    //   ? [
    //       '日期',
    //       '文字',
    //       'Translation',
    //       'Context',
    //       'ContextCloze',
    //       '笔记',
    //       'Title',
    //       'Url',
    //       'Favicon',
    //       'Audio'
    //     ]
    //   : [
    //       'Date',
    //       'Text',
    //       'Translation',
    //       'Context',
    //       'ContextCloze',
    //       'Note',
    //       'Title',
    //       'Url',
    //       'Favicon',
    //       'Audio'
    //     ]
  }

  multiline(text: string, escape: boolean): string {
    text = text.trim()
    if (!text) return ''
    if (escape) {
      text = this.escapeHTML(text)
    }
    return text.trim().replace(/\n/g, '<br/>')
  }

  parseTrans(text: string, escape: boolean): string {
    text = text.trim()
    if (!text) return ''
    const ctx = parseCtxText(text)
    const ids = Object.keys(ctx)
    if (ids.length <= 0) {
      return this.multiline(text, escape)
    }

    const trans = ids
      .map(
        id =>
          `<span class="trans_title">${id}</span><div class="trans_content">${ctx[id]}</div>`
      )
      .join('')
    return text
      .split(/\[:: \w+ ::\](?:[\s\S]+?)(?:-{15})/)
      .map(text => this.multiline(text, escape))
      .join(`<div class="trans">${trans}</div>`)
  }

  private _div: HTMLElement | undefined
  escapeHTML(text: string): string {
    if (!this._div) {
      this._div = document.createElement('div')
      this._div.appendChild(document.createTextNode(''))
    }
    this._div.firstChild!.nodeValue = text
    return this._div.innerHTML
  }

  extractTags(): string[] {
    return this.config.tags
      .split(/,|，/)
      .map(t => t.trim())
      .filter(Boolean)
  }

  async isServerUp(): Promise<boolean> {
    try {
      return (await this.request<number>('version')) != null
    } catch (e) {
      if (process.env.DEBUG) {
        console.error(e)
      }
      return false
    }
  }
}

function cardText(front: boolean, nf: string[]) {
  return `{{#${nf[4]}}}
<section>{{cloze:${nf[4]}}}</section>
<section>{{type:cloze:${nf[4]}}}</section>
{{#${nf[2]}}}
<section>{{${nf[2]}}}</section>
{{/${nf[2]}}}
{{/${nf[4]}}}

{{^${nf[4]}}}
<h1>{{${nf[1]}}}</h1>
{{#${nf[2]}}}
<section>{{${nf[2]}}}</section>
{{/${nf[2]}}}
{{/${nf[4]}}}

{{#${nf[5]}}}
<section>{{${(front ? 'hint:' : '') + nf[5]}}}</section>
{{/${nf[5]}}}

{{#${nf[6]}}}
<section class="tsource">
<hr />
{{#${nf[8]}}}
<span class="favicon" style="background-image:url({{${nf[8]}}})"></span>
{{/${nf[8]}}}
<a href="{{${nf[7]}}}">{{${nf[6]}}}</a>
</section>
{{/${nf[6]}}}
`
}

function cardCss() {
  return `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: #333;
  background-color: white;
}

a {
  color: #5caf9e;
}

input {
  border: 1px solid #eee;
}

section {
  margin: 1em 0;
}

.trans {
  border: 1px solid #eee;
  padding: 0.5em;
}

.trans_title {
  display: block;
  font-size: 0.9em;
  font-weight: bold;
}

.trans_content {
  margin-bottom: 0.5em;
}

.cloze {
  font-weight: bold;
  color: #f9690e;
}

.tsource {
  position: relative;
  font-size: .8em;
}

.tsource img {
  height: .7em;
}

.tsource a {
  text-decoration: none;
}

.typeGood {
  color: #fff;
  background: #1EBC61;
}

.typeBad {
  color: #fff;
  background: #F75C4C;
}

.typeMissed {
  color: #fff;
  background: #7C8A99;
}

.favicon {
  display: inline-block;
  width: 1em;
  height: 1em;
  background: center/cover no-repeat;
}
`
}

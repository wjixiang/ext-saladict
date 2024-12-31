/* eslint-disable no-undef */

export class YoudaoEN_T_ZH {
  getMainParaphrase(doc: Document): paraphrase {
    const transContainer = doc.querySelector('#phrsListTab .trans-container')
    if (!transContainer) {
      return {
        source: 'youdao',
        paraphrase: []
      }
    }

    const items = transContainer.querySelectorAll('li')
    const paraphrases: string[] = []
    items.forEach(item => {
      const text = item.textContent?.trim()
      if (text) {
        paraphrases.push(text)
      }
    })

    return {
      source: 'youdao',
      paraphrase: paraphrases
    }
  }

  getWebParaphrase(doc: Document): paraphrase {
    const tWebTrans = doc.querySelectorAll('#tWebTrans')
    const paraphrases: string[] = []

    tWebTrans.forEach(element => {
      const titleElements = element.querySelectorAll('.title span')
      const titles: string[] = []
      titleElements.forEach(titleEl => {
        const titleText = titleEl.textContent?.replace('\n', '').trim()
        if (titleText) {
          titles.push(titleText)
        }
      })

      const paraphraseText =
        element
          .querySelector('.collapse-content')
          ?.textContent?.replace('\n', '')
          .trim() || ''

      if (titles.length > 0 || paraphraseText) {
        paraphrases.push(`${titles.join(' ')}\n${paraphraseText}`)
      }
    })

    return {
      source: 'web',
      paraphrase: paraphrases
    }
  }

  getProfessionalParaphrase(doc: Document): paraphrase {
    const lis = doc.querySelectorAll('#tPETrans li')
    const paraphrases: string[] = []

    lis.forEach(li => {
      const title = li.querySelector('.title')?.textContent?.trim() || ''
      const paraphrase = li.querySelector('p')?.textContent?.trim() || ''

      if (title || paraphrase) {
        paraphrases.push(`${title}\n${paraphrase}`)
      }
    })

    return {
      source: 'profession',
      paraphrase: paraphrases
    }
  }

  fetchPronounce(doc: Document): pronounce[] {
    const pronounceElements = doc.querySelectorAll('.baav .pronounce')
    const pronunciations: pronounce[] = []

    pronounceElements.forEach(element => {
      const name = element.textContent ? element.textContent[0] : ''
      const phonetic =
        element.querySelector('.phonetic')?.textContent?.trim() || ''
      const dataRel = element.querySelector('a')?.getAttribute('data-rel')
      const voiceLink = dataRel
        ? `https://dict.youdao.com/dictvoice?audio=${dataRel}`
        : null

      pronunciations.push({
        name,
        phonetic,
        voiceLink
      })
    })

    return pronunciations
  }

  async translate(req: translationRequest): Promise<translationResult | null> {
    const url = 'https://dict.youdao.com/w/' + encodeURIComponent(req.queryWord)

    try {
      const response = await new Promise<string>((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'YOUDAO_TRANSLATION', word: url },
          response => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError)
            } else {
              resolve(response as string)
            }
          }
        )
      })

      if (!response) return null

      const parser = new DOMParser()
      const doc = parser.parseFromString(response, 'text/html')

      return {
        queryWord: req.queryWord,
        paraphrase: {
          main_paraphrase: this.getMainParaphrase(doc)
        },
        pronounce: this.fetchPronounce(doc),
        example_sentence: []
      }
    } catch (error) {
      console.error('Translation error:', error)
      return null
    }
  }
}

type lang = 'zh' | 'en'

export interface translation {
  title: string[]
  paraphrase: string[]
  source: string
}

export interface translationRequest {
  queryWord: string
  sourceLang: lang
  targetLang: lang
}

export interface translationResult {
  queryWord: string
  paraphrase: {
    main_paraphrase: paraphrase
    other_paraphrase?: paraphrase[]
  }
  pronounce: pronounce[]
  example_sentence: {
    sentence_raw: string
    sentence_translation: string
  }[]
}
export interface dictionary {
  option: dictionaryOption
  displayName(): Promise<string>
  translate(req: translationRequest): Promise<translationResult | null>
}

export interface dictionaryOption {
  maxexample: number
}

export interface paraphrase {
  source: string
  paraphrase: string[]
}

export interface pronounce {
  name: string
  phonetic: string
  voiceLink: string | null
}

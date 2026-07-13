# 月結び Public Beta

ふたりが毎月、関係を続けたいか、今月どう感じたかを密封して提出する LINE MINI App 向け Web アプリです。

このディレクトリは公開版専用です。既存の個人版とはコード・データベース・LINEチャネルを分離してください。

## Beta で実装済み

- 任意の呼び名・一文字アイコン・記念日
- 作成者用復元コードとパートナー招待コード
- 毎月1回、6項目を1〜10で採点
- 双方の提出前は回答を相互非公開
- 完成した契約の履歴、詳細、総合得点と推移
- 1組24枚までの非公開共有アルバム（JPEG、1枚900KB以下に自動圧縮）
- 日中二言語
- データ書き出し、プロフィール更新、アカウント削除
- 課金なしの Free Beta 表示

## ローカル確認

静的サーバーでこのフォルダを公開してください。`config.js` が空の場合は、このブラウザだけに保存するデモモードで起動します。設定画面からA/Bの役割を切り替えると、双方提出の流れを1台で確認できます。

## 新しい Supabase を接続

1. 公開版専用の新規 Supabase project を作成します。
2. Authentication → Sign In / Providers で Anonymous sign-ins を有効にします。
3. SQL Editor で `supabase/schema.sql` を実行します。
4. `config.example.js` を参考に `config.js` に Project URL と Publishable key を設定します。
5. Storage の `couple-album` が Private になっていることを確認します。

Publishable key はブラウザに置いてよい公開キーです。`service_role` key は絶対に配置しないでください。

## LINE MINI App

公開版専用の LINE MINI App channel を作成し、開発用 LIFF ID を `config.js` に設定します。Endpoint URL は公開版の HTTPS URL にします。現在の個人版チャネルは変更しません。

## 公開前に必要

- 運営者名・連絡先を入れた正式な利用規約とプライバシーポリシー
- LINE ID token のサーバー検証と端末変更フローの最終化
- 通報・問い合わせ窓口、障害監視、バックアップ
- Cloudflare Pages 等、商用サービスを許可するホスティングへの配置
- LINE の審査、課金を行う場合は入管確認後に IAP 申請

この Beta では課金処理を実装・有効化していません。

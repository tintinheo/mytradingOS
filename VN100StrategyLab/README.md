# VN100 Strategy Lab for Streamlit Community Cloud

Standalone source to copy to **your own private GitHub repository**. Entrypoint: `streamlit_app.py`. Python 3.12 recommended. No `vnstock` dependency, order placement, user accounts, broker credentials, synthetic prices or automatic source substitution.

## Deploy privately

1. Create a **private** GitHub repository and upload all files in this directory, preserving `.streamlit/config.toml` and `tests/`.
2. In [Streamlit Community Cloud](https://share.streamlit.io), connect your GitHub account and grant access to the private repository. You need repository admin rights.
3. Create an app with repository and branch `main`, and entrypoint `streamlit_app.py`. Leave the repo private; verify **Sharing → Only specific people can view this app**. Streamlit documents a limit of one private app per account in its Community Cloud sharing guide.
4. Press **Fetch and run** for one symbol or **Fetch and scan list** for up to 100 user-supplied symbols. Each run makes new website-data requests; if upstream access fails, no new signal is calculated. Use your authorized CSV export when an upstream blocks requests.

Streamlit's deployment guide: https://docs.streamlit.io/deploy/streamlit-community-cloud/deploy-your-app/deploy  
Privacy guide: https://docs.streamlit.io/deploy/streamlit-community-cloud/share-your-app

## Local run and tests

```bash
python -m venv .venv
# Activate the virtual environment for your shell.
python -m pip install -r requirements.txt
python -m streamlit run streamlit_app.py
python -m unittest discover -s tests -v
```

CSV format: `ticker,date,open,high,low,close,volume`, one row per completed session. ISO `YYYY-MM-DD` and `DD/MM/YYYY` dates are accepted. A single-symbol file may omit `ticker` if named `FPT.csv`. Verify unit scale, rights and corporate action policy before interpreting results.

## Scope and evidence

DNSE chart and CafeF history requests are experimental **website data routes**, not supported registered provider products. They were structurally tested with fixtures, but live access from Streamlit Community Cloud is unverified. Dates, prices and volume are validated on every request. Histories are not cached. See the bilingual research document in the accompanying deliverables for evidence and constraints.

Vietstock's site displays account-level restrictions on some data; SSI's public iBoard did not yield a verified reusable OHLCV history feed; VNSignal's terms prohibit bulk scraping. None are silently scraped. User-authorized exports can be imported as CSV. Kaggle's suggested seven-stock historical snapshot is not a daily live refresh source.

The editable watchlist does not verify actual or point-in-time VN100 constituents. Backtests omit adjustments for corporate actions, dividends, taxes, liquidity, settlement and exchange price limits. Forecast scenarios are separate from signals and are not guaranteed returns.

## Tiếng Việt

Đưa toàn bộ thư mục này vào **repo GitHub riêng tư**, sau đó tạo ứng dụng trong Streamlit Community Cloud với tệp chạy `streamlit_app.py`. Kiểm tra mục Sharing để chỉ những người được chọn có thể xem. Mỗi lần bấm tải hoặc quét đều yêu cầu dữ liệu mới; nguồn lỗi sẽ không sinh khuyến nghị. Có thể nhập CSV OHLCV được phép xuất từ tài khoản của bạn. Danh sách mã là do người dùng nhập, chưa được xác nhận là rổ VN100 chính thức; backtest và kịch bản dự báo không đảm bảo lợi nhuận.

from pathlib import Path

path = Path('.github/scripts/apply-pos-online-ui.py')
source = path.read_text()

old_continue = '''replace_once(
    retail,
    "onClick={() => setPaymentStage('instructions')}",
    "onClick={() => paymentChoice === 'ONLINE' ? void startOnlinePayment('EMBEDDED') : paymentChoice === 'PAYMENT_LINK' ? void startOnlinePayment('HOSTED') : setPaymentStage('instructions')}",
)'''
new_continue = '''replace_once(
    retail,
    "onClick={() => { if (paymentChoice === 'READER') void startReaderPayment(); else setPaymentStage('instructions'); }}",
    "onClick={() => { if (paymentChoice === 'READER') void startReaderPayment(); else if (paymentChoice === 'ONLINE') void startOnlinePayment('EMBEDDED'); else if (paymentChoice === 'PAYMENT_LINK') void startOnlinePayment('HOSTED'); else setPaymentStage('instructions'); }}",
)'''

old_instructions = '''replace_once(
    retail,
    "{paymentStage === 'instructions' && paymentChoice !== 'READER' &&",
    retail_online_ui + "{paymentStage === 'instructions' && (paymentChoice === 'TAP_TO_PAY' || paymentChoice === 'MANUAL_TERMINAL') &&",
)'''
new_instructions = '''replace_once(
    retail,
    "{paymentStage === 'instructions' && <>",
    retail_online_ui + "{paymentStage === 'instructions' && (paymentChoice === 'TAP_TO_PAY' || paymentChoice === 'MANUAL_TERMINAL') && <>",
)'''

if old_continue not in source:
    raise RuntimeError('Retail Continue patch block was not found.')
if old_instructions not in source:
    raise RuntimeError('Retail instructions patch block was not found.')

path.write_text(source.replace(old_continue, new_continue, 1).replace(old_instructions, new_instructions, 1))

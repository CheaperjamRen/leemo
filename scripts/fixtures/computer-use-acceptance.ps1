Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Leemo Computer Acceptance"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(520, 360)
$form.AutoScroll = $true

$prompt = New-Object System.Windows.Forms.Label
$prompt.Text = "Input"
$prompt.Location = New-Object System.Drawing.Point(24, 24)
$prompt.AutoSize = $true

$input = New-Object System.Windows.Forms.TextBox
$input.Name = "AcceptanceInput"
$input.Location = New-Object System.Drawing.Point(24, 52)
$input.Size = New-Object System.Drawing.Size(440, 30)

$button = New-Object System.Windows.Forms.Button
$button.Name = "AcceptanceConfirm"
$button.Text = "Confirm"
$button.Location = New-Object System.Drawing.Point(24, 100)
$button.Size = New-Object System.Drawing.Size(96, 34)

$result = New-Object System.Windows.Forms.Label
$result.Name = "AcceptanceResult"
$result.Text = "Waiting"
$result.Location = New-Object System.Drawing.Point(24, 156)
$result.AutoSize = $true

$spacer = New-Object System.Windows.Forms.Label
$spacer.Text = "Scroll acceptance area"
$spacer.Location = New-Object System.Drawing.Point(24, 620)
$spacer.AutoSize = $true

$button.Add_Click({
  $result.Text = "Accepted"
  $form.Text = "Accepted"
})

$form.Controls.AddRange(@($prompt, $input, $button, $result, $spacer))
[System.Windows.Forms.Application]::Run($form)

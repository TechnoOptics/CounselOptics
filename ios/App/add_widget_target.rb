# One-time wiring of the AdvotticWidget WidgetKit extension into the
# Capacitor Xcode project. This is the programmatic equivalent of the manual
# Xcode steps in docs/WIDGETS.md §iOS. Idempotent: safe to re-run.
#
#   ruby add_widget_target.rb
#
# What it does:
#   1. App target: adds WidgetBridgePlugin.swift/.m to Sources and points
#      Code Signing Entitlements at App/App.entitlements (App Group).
#   2. Creates the AdvotticWidget app-extension target from the existing
#      sources/Info.plist/entitlements in ios/App/AdvotticWidget/.
#   3. Embeds the extension in the app (Embed Foundation Extensions).
require 'xcodeproj'

project = Xcodeproj::Project.open('App.xcodeproj')
app_target = project.targets.find { |t| t.name == 'App' } or abort 'App target not found'

# ---- 1) WidgetBridge plugin into the App target --------------------------
app_group = project.main_group['App'] or abort 'App group not found'
%w[WidgetBridgePlugin.swift WidgetBridgePlugin.m].each do |name|
  path = "App/#{name}"
  ref = app_group.files.find { |f| f.path == name || f.path == path }
  ref ||= app_group.new_reference(name)
  unless app_target.source_build_phase.files_references.include?(ref)
    app_target.add_file_references([ref])
    puts "App target: added #{name}"
  end
end
app_target.build_configurations.each do |config|
  config.build_settings['CODE_SIGN_ENTITLEMENTS'] ||= 'App/App.entitlements'
end

# ---- 2) AdvotticWidget extension target ----------------------------------
widget = project.targets.find { |t| t.name == 'AdvotticWidget' }
unless widget
  widget = project.new_target(:app_extension, 'AdvotticWidget', :ios, '15.0')
  puts 'Created AdvotticWidget target'
end

widget_group = project.main_group['AdvotticWidget'] || project.main_group.new_group('AdvotticWidget', 'AdvotticWidget')
%w[AdvotticWidget.swift AdvotticWidgetBundle.swift].each do |name|
  ref = widget_group.files.find { |f| f.path == name }
  ref ||= widget_group.new_reference(name)
  unless widget.source_build_phase.files_references.include?(ref)
    widget.add_file_references([ref])
    puts "Widget target: added #{name}"
  end
end

widget.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = 'AdvotticWidget'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.advottic.app.AdvotticWidget'
  s['INFOPLIST_FILE'] = 'AdvotticWidget/Info.plist'
  s['CODE_SIGN_ENTITLEMENTS'] = 'AdvotticWidget/AdvotticWidget.entitlements'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['SKIP_INSTALL'] = 'YES'
  s['GENERATE_INFOPLIST_FILE'] = 'NO'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['MARKETING_VERSION'] = '1.0'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = ''
  s['ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME'] = ''
end

# WidgetKit + SwiftUI are auto-linked by import, but declare them so the
# link phase is explicit (matches what Xcode's template generates).
frameworks_group = project.frameworks_group
%w[WidgetKit SwiftUI].each do |fw|
  ref = frameworks_group.files.find { |f| f.path.to_s.end_with?("#{fw}.framework") }
  ref ||= frameworks_group.new_reference("System/Library/Frameworks/#{fw}.framework")
  ref.source_tree = 'SDKROOT'
  unless widget.frameworks_build_phase.files_references.include?(ref)
    widget.frameworks_build_phase.add_file_reference(ref)
  end
end

# ---- 3) Embed the extension in the app -----------------------------------
app_target.add_dependency(widget) unless app_target.dependencies.any? { |d| d.target == widget }
embed = app_target.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
unless embed
  embed = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
  puts 'Added Embed Foundation Extensions phase'
end
unless embed.files_references.include?(widget.product_reference)
  bf = embed.add_file_reference(widget.product_reference)
  bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

# The product reference must carry the real name, or the build plans an
# output literally called ".appex".
if widget.product_reference
  widget.product_reference.name = 'AdvotticWidget.appex'
  widget.product_reference.path = 'AdvotticWidget.appex'
end

project.save
puts 'Saved App.xcodeproj'

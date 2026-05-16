#!/usr/bin/env ruby
# frozen_string_literal: true

# Injects the Advottic watchOS app as an EMBEDDED COMPANION target
# into the Capacitor-generated ios/App/App.xcodeproj.
#
# Why a script (not a committed project): ios/ is wiped and
# regenerated every CI build (rm -rf ios && cap add ios), so the
# watch target must be re-added programmatically each run - the same
# pattern ios-release.yml already uses to patch AppDelegate /
# Info.plist / entitlements. xcodeproj (the CocoaPods library) is the
# canonical, well-trodden tool for pbxproj manipulation.
#
# Idempotent: if an AdvotticWatch target already exists it no-ops, so
# re-running is safe.
#
# Inputs (env, set by the workflow):
#   APPLE_TEAM_ID           DEVELOPMENT_TEAM for the watch target
#   MARKETING_VERSION       CFBundleShortVersionString (Android lockstep)
#   CURRENT_PROJECT_VERSION CFBundleVersion (Android lockstep)
#
# Layout it expects (the workflow stages these before running):
#   ios/App/App.xcodeproj                      Capacitor project
#   ios/App/AdvotticWatch/*.swift              shared watch sources
#   ios/App/AdvotticWatch/Info.plist           companion Info.plist
#   ios/App/App/PhoneWatchBridge.swift         iOS-side WCSession bridge

require 'xcodeproj'

PROJECT_PATH = 'ios/App/App.xcodeproj'
WATCH_DIR    = 'ios/App/AdvotticWatch'
WATCH_NAME   = 'AdvotticWatch'
WATCH_BUNDLE = 'com.advottic.app.watchkitapp'
APP_BUNDLE   = 'com.advottic.app'

team      = ENV['APPLE_TEAM_ID'].to_s
mkt_ver   = (ENV['MARKETING_VERSION'].to_s.empty? ? '1.0.0' : ENV['MARKETING_VERSION'])
build_ver = (ENV['CURRENT_PROJECT_VERSION'].to_s.empty? ? '1' : ENV['CURRENT_PROJECT_VERSION'])

abort "::error::#{PROJECT_PATH} not found" unless Dir.exist?(PROJECT_PATH)
abort "::error::#{WATCH_DIR} not staged"   unless Dir.exist?(WATCH_DIR)

project = Xcodeproj::Project.open(PROJECT_PATH)

app_target = project.targets.find { |t| t.name == 'App' }
abort '::error::App target not found in Capacitor project' unless app_target

if project.targets.any? { |t| t.name == WATCH_NAME }
  puts "#{WATCH_NAME} target already present - nothing to do (idempotent)."
  exit 0
end

# --- 1. Watch app target -------------------------------------------------
watch_target = project.new_target(
  :application, WATCH_NAME, :watchos, '10.0', nil, :swift
)

# Group holding the watch sources (path relative to the project dir,
# i.e. ios/App).
watch_group = project.main_group.new_group(WATCH_NAME, WATCH_NAME)

swift_files = Dir.glob(File.join(WATCH_DIR, '*.swift')).sort
abort "::error::no .swift sources in #{WATCH_DIR}" if swift_files.empty?
swift_files.each do |path|
  ref = watch_group.new_reference(File.basename(path))
  watch_target.add_file_references([ref])
end
# Info.plist is referenced via INFOPLIST_FILE, never compiled.
watch_group.new_reference('Info.plist')

watch_target.build_configurations.each do |cfg|
  bs = cfg.build_settings
  bs['PRODUCT_BUNDLE_IDENTIFIER']  = WATCH_BUNDLE
  bs['PRODUCT_NAME']               = '$(TARGET_NAME)'
  bs['INFOPLIST_FILE']             = "#{WATCH_NAME}/Info.plist"
  bs['GENERATE_INFOPLIST_FILE']    = 'NO'
  bs['SDKROOT']                    = 'watchos'
  bs['TARGETED_DEVICE_FAMILY']     = '4'
  bs['WATCHOS_DEPLOYMENT_TARGET']  = '10.0'
  bs['SWIFT_VERSION']              = '5.0'
  bs['CURRENT_PROJECT_VERSION']    = build_ver
  bs['MARKETING_VERSION']          = mkt_ver
  # CRITICAL: an EMBEDDED watch target must NOT install as its own
  # top-level archive product. With SKIP_INSTALL=NO the .xcarchive's
  # Products/Applications/ holds BOTH App.app AND a standalone
  # AdvotticWatch.app; xcodebuild's IDEDistributionMethodManager then
  # cannot pick a distribution method for a two-app archive and
  # exportArchive dies with the opaque "Unknown Distribution Error" /
  # "expected one {} but found app-store-connect". YES = the watch
  # exists ONLY embedded in App.app/Watch (the Embed Watch Content
  # phase still copies it). This is exactly how Xcode configures
  # embedded watch / app-extension targets.
  bs['SKIP_INSTALL']               = 'YES'
  bs['ENABLE_BITCODE']             = 'NO'
  bs['CODE_SIGN_STYLE']            = 'Automatic'
  bs['DEVELOPMENT_TEAM']           = team unless team.empty?
  # No asset catalog is shipped (the module is intentionally
  # binary-asset-free until the branding pass), so don't let Xcode
  # look for / require an AppIcon set.
  bs['ASSETCATALOG_COMPILER_APPICON_NAME'] = ''
end

# --- 2. iOS-side bridge into the App target ------------------------------
bridge_rel = 'App/PhoneWatchBridge.swift'
if File.exist?(File.join('ios/App', bridge_rel))
  app_group = project.main_group['App'] || project.main_group
  unless app_group.files.any? { |f| f.path == 'PhoneWatchBridge.swift' }
    bridge_ref = app_group.new_reference('PhoneWatchBridge.swift')
    app_target.add_file_references([bridge_ref])
    puts 'Added PhoneWatchBridge.swift to the App target.'
  end
else
  puts '::warning::PhoneWatchBridge.swift not staged - watch will ' \
       'receive nothing until the iOS bridge is added.'
end

# --- 3. Embed the watch app in the iOS app -------------------------------
app_target.add_dependency(watch_target)

embed = app_target.new_copy_files_build_phase('Embed Watch Content')
embed.symbol_dst_subfolder_spec = :products_directory # 16
embed.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
bf = embed.add_file_reference(watch_target.product_reference)
bf.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }

project.save

puts "Injected embedded watch target '#{WATCH_NAME}' " \
     "(#{WATCH_BUNDLE}) into #{PROJECT_PATH}."
puts "  sources : #{swift_files.map { |f| File.basename(f) }.join(', ')}"
puts "  team    : #{team.empty? ? '(unset)' : team}"
puts "  version : #{mkt_ver} (#{build_ver})"
puts "  app deps: #{app_target.dependencies.map { |d| d.target.name }.join(', ')}"
